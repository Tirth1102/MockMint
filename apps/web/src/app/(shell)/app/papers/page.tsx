'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AttemptPayload, PaperDetail, PaperSlotCard, PaperYearGroup } from '@mockmint/shared';
import { api, ApiRequestError } from '@/lib/api';
import { useSearch } from '@/lib/search';
import { useToast } from '@/lib/toast';
import ui from '@/components/ui/ui.module.css';
import styles from './papers.module.css';

type Filter = 'all' | 'recent' | 'attempted' | 'new';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All years' },
  { id: 'recent', label: '2022 onward' },
  { id: 'attempted', label: 'Attempted' },
  { id: 'new', label: 'Not attempted' },
];

const DIFFICULTY_CLASS: Record<string, string | undefined> = {
  Difficult: ui.chipBad,
  'Easy-Moderate': ui.chipOk,
  Moderate: ui.chipWarn,
};

interface PendingPaper {
  paper: PaperSlotCard;
  detail: PaperDetail;
  titaCount: number;
}

export default function PapersPage() {
  const [filter, setFilter] = useState<Filter>('all');
  const [years, setYears] = useState<PaperYearGroup[] | null>(null);
  const [pending, setPending] = useState<PendingPaper | null>(null);
  const [starting, setStarting] = useState(false);
  const { query } = useSearch();
  const { flash } = useToast();
  const router = useRouter();

  useEffect(() => {
    const params = new URLSearchParams({ filter });
    if (query.trim()) params.set('q', query.trim());
    setYears(null);
    api
      .get<{ years: PaperYearGroup[] }>(`/api/papers?${params}`)
      .then((data) => setYears(data.years))
      .catch(() => setYears([]));
  }, [filter, query]);

  const openStartModal = useCallback(
    async (paper: PaperSlotCard) => {
      try {
        const detail = await api.get<{ paper: PaperDetail; titaCount: number }>(
          `/api/papers/${paper.id}`,
        );
        setPending({ paper, detail: detail.paper, titaCount: detail.titaCount });
      } catch {
        flash('Could not open that paper');
      }
    },
    [flash],
  );

  async function startExam() {
    if (!pending) return;
    setStarting(true);
    try {
      const payload = await api.post<AttemptPayload>('/api/attempts', {
        paperId: pending.paper.id,
      });
      router.push(`/exam/${payload.attempt.id}`);
    } catch (err) {
      // 409 means a test is already running — send them to it rather than dead-ending.
      if (err instanceof ApiRequestError && err.status === 409) {
        const attemptId = (err.details as { attemptId?: string } | undefined)?.attemptId;
        if (attemptId) {
          flash('Resuming your test already in progress');
          router.push(`/exam/${attemptId}`);
          return;
        }
      }
      flash(err instanceof ApiRequestError ? err.message : 'Could not start the test');
      setStarting(false);
      setPending(null);
    }
  }

  if (!years) return <div className={ui.loading}>Loading papers…</div>;

  return (
    <div className={ui.page}>
      <div className={ui.filterRow}>
        {FILTERS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={ui.filter}
            data-active={filter === entry.id}
            onClick={() => setFilter(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {years.length === 0 ? (
        <div className={ui.empty}>
          <div className={ui.emptyIcon}>▤</div>
          <div className={ui.emptyTitle}>No papers match that filter</div>
          <div className={ui.emptyBody}>Clear the search or pick a different year range.</div>
        </div>
      ) : null}

      {years.map((group) => (
        <div key={group.year} className={styles.yearCard}>
          <div className={styles.yearHead}>
            <div className={styles.yearTitle}>CAT {group.year}</div>
            <div className={ui.chip}>
              {group.slots.length === 1 ? '1 slot' : `${group.slots.length} slots`}
            </div>
            {group.isNew ? (
              <div className={`${ui.chipMono} ${ui.chipAccent}`}>NEW</div>
            ) : null}
            <div className={styles.yearNote}>{group.note}</div>
          </div>

          <div className={styles.slotGrid}>
            {group.slots.map((slot) => (
              <div key={slot.id} className={styles.slot}>
                <div className={styles.slotHead}>
                  <div className={styles.slotName}>Slot {slot.slot}</div>
                  <div className={`${ui.chip} ${DIFFICULTY_CLASS[slot.difficulty] ?? ui.chipWarn}`}>
                    {slot.difficulty}
                  </div>
                  {slot.bestScore !== null ? (
                    <div className={styles.slotBest}>Best {slot.bestScore}</div>
                  ) : null}
                </div>

                <div className={styles.slotFacts}>
                  <div>
                    <div className={styles.factLabel}>Questions</div>
                    <div className={styles.factValue}>{slot.questionCount} questions</div>
                  </div>
                  <div>
                    <div className={styles.factLabel}>Duration</div>
                    <div className={styles.factValue}>{slot.durationMin} min</div>
                  </div>
                  <div>
                    <div className={styles.factLabel}>Total marks</div>
                    <div className={styles.factValue}>{slot.questionCount * 3} marks</div>
                  </div>
                  <div>
                    <div className={styles.factLabel}>Pattern</div>
                    <div className={styles.factValue}>{slot.pattern}</div>
                  </div>
                </div>

                <button
                  type="button"
                  className={styles.slotCta}
                  data-attempted={slot.bestScore !== null}
                  onClick={() => void openStartModal(slot)}
                >
                  {slot.bestScore !== null ? 'Re-attempt' : 'Start test'}
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}

      {pending ? (
        <div
          className={ui.modalBackdrop}
          role="dialog"
          aria-modal="true"
          aria-label="Confirm test start"
        >
          <div className={`${ui.modal} ${ui.modalPad} ${styles.startModal}`}>
            <div className={ui.modalTitle}>
              Your MockMint full-length test is about to begin.
            </div>
            <div className={ui.modalBody}>
              CAT {pending.paper.year} — Slot {pending.paper.slot} · {pending.paper.questionCount}{' '}
              questions · {pending.detail.durationMin} minutes · {pending.paper.questionCount * 3}{' '}
              marks
            </div>

            <div className={styles.rules}>
              {buildRules(pending).map((rule) => (
                <div key={rule} className={styles.rule}>
                  <span className={styles.ruleBullet} aria-hidden>
                    ·
                  </span>
                  {rule}
                </div>
              ))}
            </div>

            <div className={styles.ready}>Are you ready?</div>
            <div className={ui.modalActions}>
              <button
                type="button"
                className={`${ui.btn} ${styles.cancelBtn}`}
                onClick={() => setPending(null)}
                disabled={starting}
              >
                Cancel
              </button>
              <button
                type="button"
                className={`${ui.btnPrimary} ${styles.startBtn}`}
                onClick={() => void startExam()}
                disabled={starting}
              >
                {starting ? 'Starting…' : 'Start exam'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function buildRules(pending: PendingPaper): string[] {
  const lock = pending.detail.sections[0]?.durationMin ?? 40;
  const order = pending.detail.sections.map((s) => s.key).join(' → ');
  const mcq = pending.paper.questionCount - pending.titaCount;
  return [
    `Duration: ${pending.detail.durationMin} minutes — ${lock} minutes per section, in order ${order}.`,
    'Ensure a stable internet connection. Answers auto-save every few seconds.',
    'Once started, the timer cannot be paused. A section locks when its timer ends.',
    `${mcq} MCQ: +3 correct, −1 incorrect. ${pending.titaCount} TITA: +3 correct, no penalty.`,
  ];
}
