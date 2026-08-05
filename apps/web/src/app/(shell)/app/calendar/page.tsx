'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { CalendarPayload } from '@mockmint/shared';
import { api } from '@/lib/api';
import { useToast } from '@/lib/toast';
import { Heatmap, HeatScale } from '@/components/charts/Heatmap';
import ui from '@/components/ui/ui.module.css';
import styles from './calendar.module.css';

const PRACTICE_MODES = [
  {
    icon: '◆',
    title: 'Daily 15',
    body: 'Fifteen mixed questions, one from each of your weak topics. Resets at midnight.',
    cta: 'Start today’s set',
  },
  {
    icon: '⟳',
    title: 'Random practice',
    body: 'Pull a random set of 10 from any year, untimed, with instant explanations.',
    cta: 'Shuffle 10',
  },
];

export default function CalendarPage() {
  const [data, setData] = useState<CalendarPayload | null>(null);
  const [bookmarkCount, setBookmarkCount] = useState(0);
  const { flash } = useToast();

  useEffect(() => {
    api
      .get<CalendarPayload>('/api/me/practice/calendar?days=182')
      .then(setData)
      .catch(() => setData({ heat: [], stats: [] }));
    api
      .get<{ items: unknown[] }>('/api/me/bookmarks')
      .then((d) => setBookmarkCount(d.items.length))
      .catch(() => undefined);
  }, []);

  if (!data) return <div className={ui.loading}>Loading your calendar…</div>;

  return (
    <div className={ui.page} style={{ gap: 16 }}>
      <div className={ui.card} style={{ padding: 22 }}>
        <div className={styles.head}>
          <div className={ui.cardTitle}>Practice calendar</div>
          <HeatScale />
        </div>

        <Heatmap cells={data.heat} columns={26} />

        <div className={styles.stats}>
          {data.stats.map((stat) => (
            <div key={stat.k}>
              <div className={styles.statValue}>{stat.v}</div>
              <div className={styles.statLabel}>{stat.k}</div>
            </div>
          ))}
        </div>
      </div>

      <div className={ui.card} style={{ padding: 22 }}>
        <div className={ui.cardTitle} style={{ marginBottom: 14 }}>
          Daily practice
        </div>
        <div className={styles.modes}>
          {PRACTICE_MODES.map((mode) => (
            <div key={mode.title} className={styles.mode}>
              <div className={styles.modeIcon} aria-hidden>
                {mode.icon}
              </div>
              <div className={styles.modeTitle}>{mode.title}</div>
              <div className={styles.modeBody}>{mode.body}</div>
              <button
                type="button"
                className={styles.modeCta}
                onClick={() => flash(`${mode.title} — connect this to your question bank`)}
              >
                {mode.cta}
              </button>
            </div>
          ))}

          <div className={styles.mode}>
            <div className={styles.modeIcon} aria-hidden>
              ★
            </div>
            <div className={styles.modeTitle}>Bookmarked drill</div>
            <div className={styles.modeBody}>Re-attempt everything you starred, oldest first.</div>
            <Link href="/app/bookmarks" className={styles.modeCta}>
              Drill {bookmarkCount} saved
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
