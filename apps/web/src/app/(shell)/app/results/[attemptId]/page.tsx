'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  DIFFICULTIES,
  fmtClock,
  fmtMinutes,
  formatMarks,
  type AttemptResult,
  type ResultSummary,
  type ReviewFilter,
  type ReviewItem,
  type Suggestion,
} from '@mockmint/shared';
import { api } from '@/lib/api';
import { useToast } from '@/lib/toast';
import { TrendChart } from '@/components/charts/TrendChart';
import ui from '@/components/ui/ui.module.css';
import styles from './result.module.css';

type Tab = 'sections' | 'charts' | 'review' | 'coach';

const TABS: { id: Tab; label: string }[] = [
  { id: 'sections', label: 'Section-wise' },
  { id: 'charts', label: 'Charts' },
  { id: 'review', label: 'Question review' },
  { id: 'coach', label: 'Improvement plan' },
];

const TONE_BG: Record<Suggestion['tone'], string> = {
  bad: 'var(--badS)',
  warn: 'var(--warnS)',
  info: 'var(--infoS)',
  ok: 'var(--okS)',
};
const TONE_FG: Record<Suggestion['tone'], string> = {
  bad: 'var(--bad)',
  warn: 'var(--warn)',
  info: 'var(--info)',
  ok: 'var(--ok)',
};

/** Circumference of the donut ring (r = 54). */
const DONUT_C = 2 * Math.PI * 54;

export default function ResultPage() {
  const params = useParams<{ attemptId: string }>();
  const attemptId = params.attemptId;
  const { flash } = useToast();

  const [tab, setTab] = useState<Tab>('sections');
  const [result, setResult] = useState<AttemptResult | null>(null);
  const [timeNote, setTimeNote] = useState('');
  const [history, setHistory] = useState<ResultSummary[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>('wrong');
  const [review, setReview] = useState<{ items: ReviewItem[]; total: number } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get<{ result: AttemptResult; timeNote: string }>(`/api/attempts/${attemptId}/result`)
      .then((data) => {
        setResult(data.result);
        setTimeNote(data.timeNote);
      })
      .catch(() => setError('Could not load that result.'));

    api
      .get<{ items: ResultSummary[] }>('/api/results')
      .then((data) => setHistory(data.items))
      .catch(() => undefined);
  }, [attemptId]);

  useEffect(() => {
    if (tab !== 'coach' || suggestions.length) return;
    api
      .get<{ suggestions: Suggestion[] }>(`/api/attempts/${attemptId}/suggestions`)
      .then((data) => setSuggestions(data.suggestions))
      .catch(() => undefined);
  }, [tab, attemptId, suggestions.length]);

  useEffect(() => {
    if (tab !== 'review') return;
    setReview(null);
    api
      .get<{ items: ReviewItem[]; total: number }>(
        `/api/attempts/${attemptId}/review?filter=${reviewFilter}&limit=25`,
      )
      .then(setReview)
      .catch(() => setReview({ items: [], total: 0 }));
  }, [tab, reviewFilter, attemptId]);

  const toggleBookmark = useCallback(
    async (item: ReviewItem) => {
      const next = !item.bookmarked;
      setReview((current) =>
        current
          ? {
              ...current,
              items: current.items.map((i) =>
                i.question.id === item.question.id ? { ...i, bookmarked: next } : i,
              ),
            }
          : current,
      );
      try {
        if (next) await api.post(`/api/me/bookmarks/${item.question.id}`);
        else await api.delete(`/api/me/bookmarks/${item.question.id}`);
        flash(next ? 'Bookmarked' : 'Bookmark removed');
      } catch {
        flash('Could not update that bookmark');
      }
    },
    [flash],
  );

  if (error) return <div className={ui.errorBox}>{error}</div>;
  if (!result) return <div className={ui.loading}>Loading your analysis…</div>;

  const correctArc = (result.correct / Math.max(1, result.count)) * DONUT_C;
  const wrongArc = (result.wrong / Math.max(1, result.count)) * DONUT_C;

  return (
    <div className={ui.page} style={{ gap: 18 }}>
      {/* ---------------------------------------------------------- hero */}
      <div className={styles.hero}>
        <div>
          <div className={styles.heroEyebrow}>
            {result.paperName} · submitted {result.submittedAt}
          </div>
          <div className={styles.scoreRow}>
            <div className={styles.score}>{result.score}</div>
            <div className={styles.scoreTotal}>/ {result.totalMarks}</div>
          </div>
          <div className={styles.percentileLine}>
            Estimated percentile{' '}
            <span className={styles.percentileValue}>{result.percentile}</span>
          </div>
          <div className={styles.heroStats}>
            <HeroStat k="Accuracy" v={`${result.accuracy}%`} />
            <HeroStat k="Attempt rate" v={`${result.attemptRate}%`} />
            <HeroStat k="Correct" v={String(result.correct)} />
            <HeroStat k="Incorrect" v={String(result.wrong)} />
          </div>
        </div>

        <div className={styles.donutWrap}>
          <svg viewBox="0 0 130 130" className={styles.donut} role="img" aria-label="Answer split">
            <circle
              cx="65"
              cy="65"
              r="54"
              fill="none"
              stroke="rgba(255,255,255,.1)"
              strokeWidth="16"
            />
            <circle
              cx="65"
              cy="65"
              r="54"
              fill="none"
              stroke="var(--ok)"
              strokeWidth="16"
              strokeDasharray={`${correctArc.toFixed(1)} ${DONUT_C.toFixed(1)}`}
            />
            <circle
              cx="65"
              cy="65"
              r="54"
              fill="none"
              stroke="var(--bad)"
              strokeWidth="16"
              strokeDasharray={`${wrongArc.toFixed(1)} ${DONUT_C.toFixed(1)}`}
              strokeDashoffset={(-correctArc).toFixed(1)}
            />
          </svg>

          <div className={styles.legend}>
            <LegendRow color="var(--ok)" label="Correct" value={result.correct} />
            <LegendRow color="var(--bad)" label="Incorrect" value={result.wrong} />
            <LegendRow
              color="rgba(255,255,255,.2)"
              label="Unattempted"
              value={result.skipped}
            />
          </div>
        </div>
      </div>

      {/* ---------------------------------------------------------- tabs */}
      <div className={styles.tabs} role="tablist">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            className={styles.tab}
            data-active={tab === entry.id}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {/* ---------------------------------------------------------- sections */}
      {tab === 'sections' ? (
        <div className={`${ui.cardFlush} ${ui.tableScroll}`}>
          <div className={`${ui.tableHead} ${styles.sectionRow}`}>
            <div>Section</div>
            <div>Attempted</div>
            <div>Correct</div>
            <div>Wrong</div>
            <div>Skipped</div>
            <div>Accuracy</div>
            <div>Time</div>
            <div>Score</div>
          </div>

          {result.sections.map((section) => (
            <div key={section.key} className={`${ui.tableRow} ${styles.sectionRow}`}>
              <div>
                <div className={styles.sectionKey}>{section.key}</div>
                <div className={styles.sectionName}>{section.name}</div>
              </div>
              <div className={styles.cellMono}>
                {section.attempted}/{section.count}
              </div>
              <div className={styles.cellStrong} style={{ color: 'var(--ok)' }}>
                {section.correct}
              </div>
              <div className={styles.cellStrong} style={{ color: 'var(--bad)' }}>
                {section.wrong}
              </div>
              <div className={styles.cellMono} style={{ color: 'var(--ink3)' }}>
                {section.skipped}
              </div>
              <div className={styles.cellStrong}>{section.acc}%</div>
              <div className={styles.cellMono} style={{ color: 'var(--ink2)' }}>
                {fmtMinutes(section.timeSec)}
              </div>
              <div className={styles.cellStrong}>{section.score}</div>
            </div>
          ))}

          <div className={styles.totalRow}>
            <div className={styles.sectionKey}>Total</div>
            <div className={styles.cellStrong}>
              {result.attempted}/{result.count}
            </div>
            <div className={styles.cellStrong} style={{ color: 'var(--ok)' }}>
              {result.correct}
            </div>
            <div className={styles.cellStrong} style={{ color: 'var(--bad)' }}>
              {result.wrong}
            </div>
            <div className={styles.cellStrong} style={{ color: 'var(--ink3)' }}>
              {result.skipped}
            </div>
            <div className={styles.cellStrong}>{result.accuracy}%</div>
            <div className={styles.cellStrong}>{fmtMinutes(result.timeSec)}</div>
            <div className={styles.cellStrong} style={{ fontSize: 15 }}>
              {result.score}
            </div>
          </div>
        </div>
      ) : null}

      {/* ---------------------------------------------------------- charts */}
      {tab === 'charts' ? (
        <div className={styles.chartGrid}>
          <div className={ui.card}>
            <div className={ui.cardTitle}>Section-wise score</div>
            <div className={ui.cardSub} style={{ marginBottom: 18 }}>
              Marks obtained against maximum
            </div>
            <div className={styles.sectionBars}>
              {result.sections.map((section) => {
                const ratio = section.max ? section.score / section.max : 0;
                return (
                  <div key={section.key} className={styles.sectionBar}>
                    <div className={styles.sectionBarValue}>
                      {section.score}/{section.max}
                    </div>
                    <div className={styles.sectionBarTrack}>
                      <div
                        className={styles.sectionBarFill}
                        style={{
                          height: `${Math.max(2, Math.round(Math.max(0, ratio) * 100))}%`,
                          background:
                            ratio > 0.55
                              ? 'var(--ok)'
                              : ratio > 0.35
                                ? 'var(--warn)'
                                : 'var(--bad)',
                        }}
                      />
                    </div>
                    <div className={styles.sectionBarLabel}>{section.key}</div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className={ui.card}>
            <div className={ui.cardTitle}>Time distribution</div>
            <div className={ui.cardSub} style={{ marginBottom: 18 }}>
              Minutes spent per section vs. 40 available
            </div>
            <div className={styles.timeList}>
              {result.sections.map((section) => (
                <div key={section.key}>
                  <div className={ui.meterLabel}>
                    <span>{section.key}</span>
                    <span className={ui.mono} style={{ color: 'var(--ink2)' }}>
                      {fmtMinutes(section.timeSec)} / 40m
                    </span>
                  </div>
                  <div className={ui.meterTrack} style={{ height: 10, borderRadius: 5 }}>
                    <div
                      className={ui.meterFill}
                      style={{
                        width: `${Math.min(100, Math.round((section.timeSec / 2400) * 100))}%`,
                        background: section.timeSec > 2300 ? 'var(--bad)' : 'var(--accent)',
                        borderRadius: 5,
                      }}
                    />
                  </div>
                </div>
              ))}
              <div className={styles.timeNote}>{timeNote}</div>
            </div>
          </div>

          <div className={ui.card}>
            <div className={ui.cardTitle} style={{ marginBottom: 18 }}>
              Accuracy by difficulty
            </div>
            <div className={styles.diffList}>
              {DIFFICULTIES.map((difficulty) => {
                const agg =
                  result.difficultyAggregates.find((d) => d.difficulty === difficulty) ??
                  { difficulty, attempted: 0, correct: 0 };
                const pct = agg.attempted ? Math.round((agg.correct / agg.attempted) * 100) : 0;
                return (
                  <div key={difficulty} className={styles.diffRow}>
                    <div className={styles.diffLabel}>{difficulty}</div>
                    <div className={styles.diffTrack}>
                      <div
                        className={styles.diffFill}
                        style={{
                          width: `${pct}%`,
                          background:
                            pct > 65 ? 'var(--ok)' : pct > 45 ? 'var(--warn)' : 'var(--bad)',
                        }}
                      />
                    </div>
                    <div className={styles.diffValue}>
                      {agg.correct}/{agg.attempted} · {pct}%
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className={ui.card}>
            <div className={ui.cardTitle} style={{ marginBottom: 18 }}>
              Score trend across attempts
            </div>
            <TrendChart
              points={history.map((h) => ({
                label: `S${h.slot}'${String(h.year).slice(2)}`,
                score: h.score,
              }))}
              width={480}
              height={170}
              showGrid={false}
            />
          </div>
        </div>
      ) : null}

      {/* ---------------------------------------------------------- review */}
      {tab === 'review' ? (
        <div className={ui.page} style={{ gap: 14 }}>
          <div className={styles.reviewHead}>
            {(
              [
                ['all', `All ${result.count}`],
                ['wrong', 'Incorrect'],
                ['correct', 'Correct'],
                ['skipped', 'Unattempted'],
                ['bookmarked', 'Bookmarked'],
              ] as [ReviewFilter, string][]
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={ui.filter}
                data-active={reviewFilter === id}
                onClick={() => setReviewFilter(id)}
              >
                {label}
              </button>
            ))}
            {review ? (
              <div className={styles.reviewCount}>
                {review.total} of {result.count} questions
              </div>
            ) : null}
          </div>

          {!review ? (
            <div className={ui.loading}>Loading questions…</div>
          ) : review.items.length === 0 ? (
            <div className={ui.empty}>
              <div className={ui.emptyIcon}>◎</div>
              <div className={ui.emptyTitle}>Nothing in this filter</div>
              <div className={ui.emptyBody}>Try another slice of the paper.</div>
            </div>
          ) : (
            review.items.map((item) => <ReviewCard key={item.question.id} item={item} onBookmark={toggleBookmark} />)
          )}
        </div>
      ) : null}

      {/* ---------------------------------------------------------- coach */}
      {tab === 'coach' ? (
        <div className={ui.page} style={{ gap: 14 }}>
          {suggestions.length === 0 ? (
            <div className={ui.loading}>Building your plan…</div>
          ) : (
            suggestions.map((suggestion) => (
              <div key={suggestion.title} className={styles.suggestion}>
                <div
                  className={styles.suggestionIcon}
                  style={{ background: TONE_BG[suggestion.tone], color: TONE_FG[suggestion.tone] }}
                  aria-hidden
                >
                  {suggestion.icon}
                </div>
                <div>
                  <div className={styles.suggestionTitle}>{suggestion.title}</div>
                  <div className={styles.suggestionBody}>{suggestion.body}</div>
                  <div className={styles.suggestionTags}>
                    {suggestion.tags.map((tag) => (
                      <div key={tag} className={styles.suggestionTag}>
                        {tag}
                      </div>
                    ))}
                  </div>
                </div>
                <div
                  className={styles.suggestionPriority}
                  style={{ color: TONE_FG[suggestion.tone] }}
                >
                  {suggestion.priority}
                </div>
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

function HeroStat({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className={styles.heroStatValue}>{v}</div>
      <div className={styles.heroStatLabel}>{k}</div>
    </div>
  );
}

function LegendRow({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <div className={styles.legendRow}>
      <div className={styles.legendSwatch} style={{ background: color }} />
      <div className={styles.legendLabel}>{label}</div>
      <div className={styles.legendValue}>{value}</div>
    </div>
  );
}

function ReviewCard({
  item,
  onBookmark,
}: {
  item: ReviewItem;
  onBookmark: (item: ReviewItem) => void;
}) {
  const attempted = item.answer !== null;
  const state = item.isCorrect ? 'correct' : attempted ? 'wrong' : 'skipped';
  const { question } = item;

  const userAnswer = !attempted
    ? 'Not attempted'
    : 'option' in item.answer!
      ? `${'ABCD'[item.answer.option] ?? '?'}. ${question.opts[item.answer.option] ?? ''}`
      : item.answer!.text;

  const correctAnswer =
    question.type === 'TITA'
      ? String(question.answer)
      : `${'ABCD'[Number(question.answer)] ?? '?'}. ${question.opts[Number(question.answer)] ?? ''}`;

  const diffClass =
    question.diff === 'Hard' ? ui.chipBad : question.diff === 'Easy' ? ui.chipOk : ui.chipWarn;

  return (
    <div className={styles.reviewCard} data-state={state}>
      <div className={styles.reviewMeta}>
        <div className={styles.reviewNo}>Q{question.no}</div>
        <div className={ui.chip}>{question.sec}</div>
        <div className={ui.chip}>{question.type}</div>
        <div className={ui.chip}>{question.topic}</div>
        <div className={`${ui.chip} ${diffClass}`}>{question.diff}</div>
        <div className={styles.reviewRight}>
          <div className={styles.reviewTime}>◷ {fmtClock(item.timeSpentSec)}</div>
          <div
            className={styles.reviewMarks}
            style={{
              color: item.isCorrect
                ? 'var(--ok)'
                : attempted && question.type === 'MCQ'
                  ? 'var(--bad)'
                  : 'var(--ink3)',
            }}
          >
            {formatMarks(item.marksAwarded, attempted)}
          </div>
        </div>
      </div>

      {question.passage ? <div className={styles.reviewPassage}>{question.passage}</div> : null}

      <div className={styles.reviewText}>{question.text}</div>

      <div className={styles.answerGrid}>
        <div className={styles.answerBox} data-state={state === 'skipped' ? undefined : state}>
          <div className={styles.answerLabel}>Your answer</div>
          <div
            className={styles.answerValue}
            data-state={state === 'skipped' ? undefined : state}
          >
            {userAnswer}
          </div>
        </div>
        <div className={styles.answerBox} data-state="correct">
          <div className={styles.answerLabel}>Correct answer</div>
          <div className={styles.answerValue} data-state="correct">
            {correctAnswer}
          </div>
        </div>
      </div>

      {question.explanation ? (
        <div className={styles.explanation}>
          <div className={styles.explanationLabel}>Explanation</div>
          <div className={styles.explanationBody}>{question.explanation}</div>
        </div>
      ) : null}

      <button
        type="button"
        className={styles.bookmarkBtn}
        data-on={item.bookmarked}
        onClick={() => onBookmark(item)}
      >
        {item.bookmarked ? '★ Bookmarked' : '☆ Bookmark this'}
      </button>
    </div>
  );
}
