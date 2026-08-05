'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  SECTIONS,
  fmtClock,
  type AttemptPayload,
  type AttemptResponse,
  type ExamQuestion,
} from '@mockmint/shared';
import { api, ApiRequestError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useToast } from '@/lib/toast';
import { RequireAuth } from '@/components/RequireAuth';
import ui from '@/components/ui/ui.module.css';
import styles from './exam.module.css';

/** Local mirror of a stored response; `answer` is null when cleared. */
type AnswerValue = { option: number } | { text: string } | null;

interface LocalResponse {
  answer: AnswerValue;
  marked: boolean;
  visited: boolean;
  timeSpentSec: number;
}

export default function ExamPage() {
  return (
    <RequireAuth>
      <ExamRunner />
    </RequireAuth>
  );
}

function ExamRunner() {
  const params = useParams<{ attemptId: string }>();
  const attemptId = params.attemptId;
  const router = useRouter();
  const { user } = useAuth();
  const { flash } = useToast();

  const [payload, setPayload] = useState<AttemptPayload | null>(null);
  const [responses, setResponses] = useState<Record<string, LocalResponse>>({});
  const [bookmarks, setBookmarks] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [modal, setModal] = useState<'none' | 'early' | 'timeup'>('none');
  const [submitting, setSubmitting] = useState(false);
  const [loadError, setLoadError] = useState('');

  /** serverNow − clientNow at load. Every countdown is computed against server time. */
  const clockOffset = useRef(0);
  /** Guards against firing submit twice when the last deadline passes. */
  const autoSubmitted = useRef(false);
  /** Section index we last announced, so the "moved to X" toast fires once. */
  const announcedSection = useRef<number | null>(null);

  // ------------------------------------------------------------ load

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const data = await api.get<AttemptPayload>('/api/attempts/active');
        if (cancelled) return;

        if (!data || !('attempt' in data) || data.attempt.id !== attemptId) {
          // Not the live attempt — it was submitted, so send them to its analysis.
          router.replace(`/app/results/${attemptId}`);
          return;
        }

        clockOffset.current = new Date(data.serverNow).getTime() - Date.now();
        setPayload(data);
        setResponses(toLocalResponses(data.responses));

        const bookmarked = await api
          .get<{ items: { questionId: string }[] }>('/api/me/bookmarks')
          .catch(() => ({ items: [] as { questionId: string }[] }));
        if (!cancelled) setBookmarks(new Set(bookmarked.items.map((b) => b.questionId)));

        // Resume at the first unanswered question of the live section.
        const active = data.attempt.currentSection;
        const resumeAt = data.questions.findIndex(
          (q) => q.si === active && !data.responses.some((r) => r.questionId === q.id && r.answer),
        );
        setCursor(resumeAt === -1 ? Math.max(0, data.questions.findIndex((q) => q.si === active)) : resumeAt);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiRequestError && err.status === 404) {
          router.replace('/app');
          return;
        }
        setLoadError('Could not load this test.');
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [attemptId, router]);

  // ------------------------------------------------------------ clock

  const question: ExamQuestion | undefined = payload?.questions[cursor];

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const serverNow = now + clockOffset.current;

  const timing = useMemo(() => {
    if (!payload) return null;
    const deadlines = payload.attempt.sectionDeadlines.map((d) => new Date(d).getTime());
    const startedAt = new Date(payload.attempt.startedAt).getTime();

    const remaining = deadlines.map((deadline, i) => {
      const windowStart = i === 0 ? startedAt : (deadlines[i - 1] ?? startedAt);
      if (serverNow < windowStart) return Math.round((deadline - windowStart) / 1000);
      return Math.max(0, Math.round((deadline - serverNow) / 1000));
    });

    const activeIndex = deadlines.findIndex((d) => serverNow < d);
    return { remaining, activeIndex, expired: activeIndex === -1 };
  }, [payload, serverNow]);

  // Accrue time against the question on screen, once per second.
  useEffect(() => {
    if (!question || !timing || timing.expired || modal !== 'none') return;
    const id = setInterval(() => {
      setResponses((prev) => {
        const existing = prev[question.id] ?? blankResponse();
        return { ...prev, [question.id]: { ...existing, timeSpentSec: existing.timeSpentSec + 1 } };
      });
    }, 1000);
    return () => clearInterval(id);
  }, [question, timing, modal]);

  // Section rollover: when the live section changes, jump to its first question.
  useEffect(() => {
    if (!payload || !timing || timing.expired) return;
    const active = timing.activeIndex;
    if (announcedSection.current === null) {
      announcedSection.current = active;
      return;
    }
    if (active !== announcedSection.current) {
      announcedSection.current = active;
      const first = payload.questions.findIndex((q) => q.si === active);
      if (first !== -1) setCursor(first);
      flash(`Section time over — moved to ${SECTIONS[active]?.key ?? ''}`);
    }
  }, [timing, payload, flash]);

  // Final deadline passed — the server has already auto-submitted; confirm and show the modal.
  useEffect(() => {
    if (!timing?.expired || autoSubmitted.current || !payload) return;
    autoSubmitted.current = true;
    void api
      .post(`/api/attempts/${attemptId}/submit`, { reason: 'timeup' })
      .catch(() => undefined)
      .then(() => setModal('timeup'));
  }, [timing?.expired, attemptId, payload]);

  // ------------------------------------------------------------ persistence

  const save = useCallback(
    async (questionId: string, patch: Partial<LocalResponse> & { answerTouched?: boolean }) => {
      const current = responses[questionId] ?? blankResponse();
      const body: Record<string, unknown> = {
        questionId,
        visited: true,
        markedForReview: patch.marked ?? current.marked,
        timeSpentSec: patch.timeSpentSec ?? current.timeSpentSec,
      };
      // Only send `answer` when it actually changed — omitting it preserves the stored value.
      if (patch.answerTouched) body.answer = patch.answer ?? null;

      try {
        await api.patch(`/api/attempts/${attemptId}/response`, body);
      } catch (err) {
        if (err instanceof ApiRequestError && err.status === 409) {
          flash(err.message);
        }
      }
    },
    [attemptId, responses, flash],
  );

  // Flush accumulated per-question time every 5 seconds, like the prototype's autosave.
  useEffect(() => {
    if (!question || !timing || timing.expired) return;
    const id = setInterval(() => {
      const local = responses[question.id];
      if (local) void save(question.id, { timeSpentSec: local.timeSpentSec });
    }, 5000);
    return () => clearInterval(id);
  }, [question, responses, save, timing]);

  // ------------------------------------------------------------ actions

  const sectionLocked = Boolean(
    !timing || timing.expired || (question && question.si !== timing.activeIndex),
  );

  function updateLocal(questionId: string, patch: Partial<LocalResponse>) {
    setResponses((prev) => ({
      ...prev,
      [questionId]: { ...(prev[questionId] ?? blankResponse()), ...patch, visited: true },
    }));
  }

  function pickOption(index: number) {
    if (!question || sectionLocked) return;
    const answer = { option: index };
    updateLocal(question.id, { answer });
    void save(question.id, { answer, answerTouched: true });
  }

  function setTita(text: string) {
    if (!question || sectionLocked) return;
    const answer = text.trim() === '' ? null : { text };
    updateLocal(question.id, { answer });
    void save(question.id, { answer, answerTouched: true });
  }

  function clearResponse() {
    if (!question || sectionLocked) return;
    updateLocal(question.id, { answer: null });
    void save(question.id, { answer: null, answerTouched: true });
    flash('Response cleared');
  }

  function markAndNext() {
    if (!question || sectionLocked) return;
    updateLocal(question.id, { marked: true });
    void save(question.id, { marked: true });
    step(1);
  }

  function step(delta: number) {
    if (!payload || !timing) return;
    const next = cursor + delta;
    const target = payload.questions[next];
    if (!target) return;
    if (target.si !== timing.activeIndex) {
      flash('That section is locked');
      return;
    }
    goTo(next);
  }

  function goTo(index: number) {
    if (!payload) return;
    const target = payload.questions[index];
    if (!target) return;
    setCursor(index);
    updateLocal(target.id, { visited: true });
    void save(target.id, { visited: true });
  }

  function goToSection(sectionIndex: number) {
    if (!payload || !timing) return;
    if (sectionIndex !== timing.activeIndex) {
      const key = SECTIONS[sectionIndex]?.key ?? '';
      flash(
        sectionIndex < timing.activeIndex
          ? `${key} is locked — its time is over`
          : `${key} has not opened yet`,
      );
      return;
    }
    const first = payload.questions.findIndex((q) => q.si === sectionIndex);
    if (first !== -1) goTo(first);
  }

  async function toggleBookmark() {
    if (!question) return;
    const on = bookmarks.has(question.id);
    setBookmarks((prev) => {
      const next = new Set(prev);
      if (on) next.delete(question.id);
      else next.add(question.id);
      return next;
    });
    try {
      if (on) await api.delete(`/api/me/bookmarks/${question.id}`);
      else await api.post(`/api/me/bookmarks/${question.id}`);
      flash(on ? 'Bookmark removed' : 'Bookmarked');
    } catch {
      flash('Could not update that bookmark');
    }
  }

  async function submitExam() {
    if (submitting) return;
    setSubmitting(true);
    try {
      // Flush the current question's time before the server grades.
      if (question) {
        const local = responses[question.id];
        if (local) await save(question.id, { timeSpentSec: local.timeSpentSec });
      }
      await api.post(`/api/attempts/${attemptId}/submit`, { reason: 'manual' });
      router.replace(`/app/results/${attemptId}`);
    } catch {
      flash('Could not submit — retrying is safe');
      setSubmitting(false);
    }
  }

  // ------------------------------------------------------------ render

  if (loadError) {
    return (
      <div className={ui.errorBox} style={{ margin: 40 }}>
        {loadError}
      </div>
    );
  }
  if (!payload || !question || !timing) {
    return <div className={ui.loading}>Loading your test…</div>;
  }

  const sectionQuestions = payload.questions.filter((q) => q.si === question.si);
  const answeredTotal = Object.values(responses).filter((r) => r.answer !== null).length;
  const legend = buildLegend(sectionQuestions, responses);
  const local = responses[question.id] ?? blankResponse();
  const selectedOption = local.answer && 'option' in local.answer ? local.answer.option : null;
  const titaValue = local.answer && 'text' in local.answer ? local.answer.text : '';
  const sectionRemaining = timing.remaining[question.si] ?? 0;

  return (
    <div className={styles.runner}>
      <header className={styles.header}>
        <div className={styles.identity}>
          <div className={styles.mark} aria-hidden>
            M
          </div>
          <div>
            <div className={styles.paperName}>{payload.attempt.paper.title}</div>
            <div className={styles.candidate}>
              {user?.name} · Roll CT{payload.attempt.paper.year % 100}0{payload.attempt.paper.slot}
              4471
            </div>
          </div>
        </div>

        <div className={styles.sectionTabs}>
          {SECTIONS.map((section, i) => {
            const remaining = timing.remaining[i] ?? 0;
            const locked = remaining === 0 || i !== timing.activeIndex;
            return (
              <button
                key={section.key}
                type="button"
                className={styles.sectionTab}
                data-active={i === timing.activeIndex}
                data-locked={locked}
                onClick={() => goToSection(i)}
              >
                {section.key}
                <span className={styles.sectionTabTime}>{fmtClock(remaining)}</span>
              </button>
            );
          })}
        </div>

        <div className={styles.headerRight}>
          <div>
            <div className={styles.timerLabel}>Section time left</div>
            <div
              className={styles.timer}
              data-urgent={sectionRemaining < 300}
              data-critical={sectionRemaining < 60}
              aria-live="off"
            >
              {fmtClock(sectionRemaining)}
            </div>
          </div>
          <button type="button" className={styles.submitBtn} onClick={() => setModal('early')}>
            Submit test
          </button>
        </div>
      </header>

      <div className={styles.body}>
        <div className={styles.questionPane}>
          <div className={styles.questionScroll}>
            <div className={styles.questionInner}>
              <div className={styles.questionMeta}>
                <div className={styles.questionNo}>
                  Question {question.secNo}{' '}
                  <span className={styles.questionNoTotal}>of {sectionQuestions.length}</span>
                </div>
                <div className={`${ui.chip} ${ui.chipInfo} ${ui.mono}`}>{question.type}</div>
                <div className={ui.chip}>{question.topic}</div>
                <div className={styles.marksHint}>
                  +{question.marks} / {question.neg ? `−${question.neg}` : '0'}
                </div>
                <button
                  type="button"
                  className={styles.bookmarkBtn}
                  data-on={bookmarks.has(question.id)}
                  onClick={() => void toggleBookmark()}
                >
                  {bookmarks.has(question.id) ? '★ Bookmarked' : '☆ Bookmark'}
                </button>
              </div>

              <div
                className={styles.questionGrid}
                style={{ gridTemplateColumns: question.passage ? '1fr 1fr' : '1fr' }}
              >
                {question.passage ? (
                  <div className={styles.passage}>
                    <div className={styles.passageLabel}>
                      {question.passageLabel ??
                        (question.sec === 'VARC' ? 'Read the passage' : 'Study the data')}
                    </div>
                    <div className={styles.passageBody}>{question.passage}</div>
                  </div>
                ) : null}

                <div>
                  <div className={styles.stem}>{question.text}</div>

                  {question.type === 'MCQ' ? (
                    <div className={styles.options} role="radiogroup" aria-label="Answer options">
                      {question.opts.map((text, index) => (
                        <button
                          key={index}
                          type="button"
                          role="radio"
                          aria-checked={selectedOption === index}
                          className={styles.option}
                          data-selected={selectedOption === index}
                          disabled={sectionLocked}
                          onClick={() => pickOption(index)}
                        >
                          <span className={styles.optionLetter}>{'ABCD'[index]}</span>
                          <span>{text}</span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div>
                      <label className={ui.label} htmlFor="tita">
                        Type your answer
                      </label>
                      <input
                        id="tita"
                        className={styles.titaInput}
                        value={titaValue}
                        disabled={sectionLocked}
                        onChange={(e) => setTita(e.target.value)}
                        placeholder="e.g. 24"
                        inputMode="decimal"
                        autoComplete="off"
                      />
                      <div className={styles.titaHint}>
                        No negative marking on TITA. Numeric values only.
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className={styles.actions}>
            <button
              type="button"
              className={styles.clearBtn}
              onClick={clearResponse}
              disabled={sectionLocked}
            >
              Clear response
            </button>
            <button
              type="button"
              className={styles.markBtn}
              onClick={markAndNext}
              disabled={sectionLocked}
            >
              Mark for review &amp; next
            </button>
            <div className={styles.navRight}>
              <button type="button" className={styles.prevBtn} onClick={() => step(-1)}>
                ← Previous
              </button>
              <button
                type="button"
                className={styles.nextBtn}
                onClick={() => {
                  flash('Saved');
                  step(1);
                }}
              >
                Save &amp; next →
              </button>
            </div>
          </div>
        </div>

        <aside className={styles.sidebar}>
          <div className={styles.sidebarHead}>
            <div className={styles.sidebarAvatar} aria-hidden>
              {user?.initials ?? '··'}
            </div>
            <div>
              <div className={styles.sidebarName}>{user?.name}</div>
              <div className={styles.sidebarSection}>
                {SECTIONS[question.si]?.name ?? question.sec}
              </div>
            </div>
          </div>

          <div className={styles.progressBlock}>
            <div className={styles.progressLabel}>
              <span>Progress</span>
              <span className={ui.mono}>
                {answeredTotal}/{payload.questions.length}
              </span>
            </div>
            <div className={styles.progressTrack}>
              <div
                className={styles.progressFill}
                style={{
                  width: `${Math.round((answeredTotal / Math.max(1, payload.questions.length)) * 100)}%`,
                }}
              />
            </div>
          </div>

          <div className={styles.legend}>
            {legend.map((entry) => (
              <div key={entry.label} className={styles.legendRow}>
                <div
                  className={styles.legendSwatch}
                  style={{ background: entry.bg, border: `1px solid ${entry.bd}` }}
                />
                <div className={styles.legendText}>
                  {entry.label} <span className={styles.legendCount}>{entry.count}</span>
                </div>
              </div>
            ))}
          </div>

          <div className={styles.paletteWrap}>
            <div className={styles.paletteTitle}>Question palette</div>
            <div className={styles.palette}>
              {sectionQuestions.map((q) => {
                const state = paletteState(responses[q.id]);
                const index = payload.questions.indexOf(q);
                return (
                  <button
                    key={q.id}
                    type="button"
                    className={styles.paletteBtn}
                    data-state={state}
                    data-current={index === cursor}
                    onClick={() => goTo(index)}
                    aria-label={`Question ${q.secNo}, ${state}`}
                  >
                    {q.secNo}
                    {bookmarks.has(q.id) ? (
                      <span className={styles.paletteStar} aria-hidden>
                        ★
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>

          <div className={styles.sidebarFoot}>
            Answers save automatically. Sections lock when their timer ends.
          </div>
        </aside>
      </div>

      {/* ---------------------------------------------------------- modals */}
      {modal === 'early' ? (
        <div className={ui.modalBackdrop} role="dialog" aria-modal="true">
          <div className={`${ui.modal} ${ui.modalPad}`} style={{ maxWidth: 440 }}>
            <div className={ui.modalTitle} style={{ fontSize: 24 }}>
              You still have {fmtClock(sectionRemaining)} remaining.
            </div>
            <div className={ui.modalBody}>
              Are you sure you want to submit? Once submitted, you cannot resume this attempt.
            </div>

            <div className={styles.submitSummary}>
              {legend.map((entry) => (
                <div key={entry.label} className={styles.summaryCell}>
                  <div className={styles.summaryValue} style={{ color: entry.fg }}>
                    {entry.count}
                  </div>
                  <div className={styles.summaryLabel}>{entry.label}</div>
                </div>
              ))}
            </div>

            <div className={ui.modalActions}>
              <button
                type="button"
                className={ui.btnPrimary}
                style={{ flex: 1.3 }}
                onClick={() => setModal('none')}
              >
                Continue exam
              </button>
              <button
                type="button"
                className={ui.btn}
                style={{ flex: 1 }}
                onClick={() => void submitExam()}
                disabled={submitting}
              >
                {submitting ? 'Submitting…' : 'Submit anyway'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {modal === 'timeup' ? (
        <div className={ui.modalBackdrop} role="dialog" aria-modal="true" style={{ zIndex: 130 }}>
          <div className={`${ui.modal} ${styles.timeUpModal}`}>
            <div className={styles.timeUpIcon} aria-hidden>
              ◷
            </div>
            <div className={ui.modalTitle}>Time is over.</div>
            <div className={ui.modalBody} style={{ marginBottom: 22 }}>
              Your responses have been submitted successfully.
            </div>
            <button
              type="button"
              className={ui.btnPrimary}
              style={{ width: '100%', padding: 13 }}
              onClick={() => router.replace(`/app/results/${attemptId}`)}
            >
              View analysis
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- helpers

function blankResponse(): LocalResponse {
  return { answer: null, marked: false, visited: false, timeSpentSec: 0 };
}

function toLocalResponses(list: AttemptResponse[]): Record<string, LocalResponse> {
  const out: Record<string, LocalResponse> = {};
  for (const r of list) {
    out[r.questionId] = {
      answer: r.answer,
      marked: r.markedForReview,
      visited: r.visited,
      timeSpentSec: r.timeSpentSec,
    };
  }
  return out;
}

type PaletteState = 'answered' | 'marked' | 'visited' | 'untouched';

/** Marked wins over answered, matching the prototype's palette precedence. */
function paletteState(response: LocalResponse | undefined): PaletteState {
  if (!response) return 'untouched';
  if (response.marked) return 'marked';
  if (response.answer !== null) return 'answered';
  if (response.visited) return 'visited';
  return 'untouched';
}

function buildLegend(
  sectionQuestions: ExamQuestion[],
  responses: Record<string, LocalResponse>,
): { label: string; count: number; bg: string; bd: string; fg: string }[] {
  const counts = { answered: 0, visited: 0, marked: 0, untouched: 0 };
  for (const q of sectionQuestions) counts[paletteState(responses[q.id])] += 1;

  return [
    { label: 'Answered', count: counts.answered, bg: 'var(--ok)', bd: 'var(--ok)', fg: 'var(--ok)' },
    {
      label: 'Not answered',
      count: counts.visited,
      bg: 'var(--badS)',
      bd: 'var(--bad)',
      fg: 'var(--bad)',
    },
    {
      label: 'Marked',
      count: counts.marked,
      bg: 'var(--warn)',
      bd: 'var(--warn)',
      fg: 'var(--warn)',
    },
    {
      label: 'Not visited',
      count: counts.untouched,
      bg: 'var(--surface2)',
      bd: 'var(--line)',
      fg: 'var(--ink3)',
    },
  ];
}
