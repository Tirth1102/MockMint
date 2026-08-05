/**
 * Exam engine.
 *
 * The server owns time. `attempts.section_deadline_at` holds one absolute timestamp per
 * section, written when the attempt is created; the client's countdown is display only,
 * so refreshing, reconnecting or editing the clock cannot buy a candidate extra time.
 * Sections run strictly in order (VARC → DILR → QA) and a section is writable only
 * while `now` falls inside its window.
 */
import type pg from 'pg';
import {
  SECTIONS,
  estimatePercentileForPaper,
  grade,
  type Difficulty,
  type ExamQuestion,
  type QuestionType,
  type SectionKey,
} from '@mockmint/shared';
import { queryOne, queryRows, transaction } from '../../db/pool.js';
import { conflict, forbidden, notFound } from '../../lib/errors.js';

export interface AttemptRow {
  id: string;
  user_id: string;
  paper_id: string;
  status: 'in_progress' | 'submitted' | 'expired';
  current_section: number;
  section_deadline_at: (Date | string)[];
  started_at: Date;
  submitted_at: Date | null;
  auto_submitted: boolean;
}

export interface QuestionRow {
  id: string;
  code: string;
  section_key: SectionKey;
  position: number;
  type: QuestionType;
  stem: string;
  options: string[];
  correct_option: number | null;
  tita_answer: string | null;
  explanation: string;
  difficulty: Difficulty;
  topic: string;
  marks: number;
  negative_marks: number;
  image_url: string | null;
  passage_body: string | null;
  passage_label: string | null;
}

export const QUESTION_SELECT = `
  q.id, q.code, q.section_key, q.position, q.type, q.stem, q.options, q.correct_option,
  q.tita_answer, q.explanation, q.difficulty, q.topic, q.marks, q.negative_marks, q.image_url,
  pg_.body AS passage_body, pg_.label AS passage_label
`;

export const QUESTION_FROM = `
  FROM questions q
  LEFT JOIN passages pg_ ON pg_.id = q.passage_id
`;

/** Orders questions by section order then position — the paper's true reading order. */
export const QUESTION_ORDER = `
  ORDER BY array_position(ARRAY['VARC','DILR','QA']::text[], q.section_key), q.position
`;

/**
 * Strips the answer key. This is the only shape a question takes before submission —
 * `correct_option`, `tita_answer` and `explanation` never reach an in-progress client.
 */
export function toExamQuestion(row: QuestionRow, index: number, secIndex: number): ExamQuestion {
  return {
    id: row.id,
    no: index + 1,
    secNo: row.position,
    sec: row.section_key,
    si: secIndex,
    type: row.type,
    topic: row.topic,
    diff: row.difficulty,
    passage: row.passage_body,
    passageLabel: row.passage_label,
    text: row.stem,
    opts: Array.isArray(row.options) ? row.options : [],
    marks: Number(row.marks),
    neg: row.type === 'TITA' ? 0 : Number(row.negative_marks),
    imageUrl: row.image_url,
  };
}

export function loadExamQuestions(paperId: string): Promise<QuestionRow[]> {
  return queryRows<QuestionRow>(
    `SELECT ${QUESTION_SELECT} ${QUESTION_FROM} WHERE q.paper_id = $1 ${QUESTION_ORDER}`,
    [paperId],
  );
}

export function examQuestionsFrom(rows: QuestionRow[]): ExamQuestion[] {
  return rows.map((row, i) =>
    toExamQuestion(
      row,
      i,
      SECTIONS.findIndex((s) => s.key === row.section_key),
    ),
  );
}

// ---------------------------------------------------------------- time

export interface SectionState {
  /** Index of the section that is currently writable, or null once the attempt is over. */
  currentSection: number | null;
  /** Seconds remaining per section, in section order. Zero for expired sections. */
  remaining: number[];
  /** True when the final section's deadline has passed. */
  expired: boolean;
  deadlines: string[];
}

export function sectionState(row: AttemptRow, now = new Date()): SectionState {
  const deadlines = row.section_deadline_at.map((d) => new Date(d));
  const ms = now.getTime();

  const remaining = deadlines.map((deadline, i) => {
    const previous = i === 0 ? row.started_at : deadlines[i - 1];
    const windowStart = new Date(previous ?? row.started_at).getTime();
    // A section that has not opened yet still shows its full allowance.
    if (ms < windowStart) return Math.max(0, Math.round((deadline.getTime() - windowStart) / 1000));
    return Math.max(0, Math.round((deadline.getTime() - ms) / 1000));
  });

  const activeIndex = deadlines.findIndex((d) => ms < d.getTime());

  return {
    currentSection: activeIndex === -1 ? null : activeIndex,
    remaining,
    expired: activeIndex === -1,
    deadlines: deadlines.map((d) => d.toISOString()),
  };
}

/** Builds the deadline array for a new attempt: sections run back-to-back from `start`. */
export function buildDeadlines(start: Date, durationsMin: number[]): Date[] {
  let cursor = start.getTime();
  return durationsMin.map((mins) => {
    cursor += mins * 60_000;
    return new Date(cursor);
  });
}

// ---------------------------------------------------------------- lookup

export async function loadAttempt(attemptId: string, userId: string): Promise<AttemptRow> {
  const row = await queryOne<AttemptRow>(
    `SELECT id, user_id, paper_id, status, current_section, section_deadline_at,
            started_at, submitted_at, auto_submitted
       FROM attempts WHERE id = $1`,
    [attemptId],
  );
  if (!row) throw notFound('Attempt not found.');
  // Ownership is checked on every response write and result read (ARCHITECTURE.md §6).
  if (row.user_id !== userId) throw forbidden('That attempt belongs to another account.');
  return row;
}

export async function findActiveAttempt(userId: string): Promise<AttemptRow | null> {
  return queryOne<AttemptRow>(
    `SELECT id, user_id, paper_id, status, current_section, section_deadline_at,
            started_at, submitted_at, auto_submitted
       FROM attempts WHERE user_id = $1 AND status = 'in_progress'`,
    [userId],
  );
}

export function assertWritable(row: AttemptRow, questionSection: SectionKey): void {
  if (row.status !== 'in_progress') throw conflict('This attempt has already been submitted.');

  const state = sectionState(row);
  if (state.expired) throw conflict('Time is over for this attempt.');

  const target = SECTIONS.findIndex((s) => s.key === questionSection);
  if (target !== state.currentSection) {
    const name = SECTIONS[target]?.key ?? questionSection;
    throw conflict(
      target < (state.currentSection ?? 0)
        ? `${name} is locked — its time is over.`
        : `${name} has not opened yet.`,
    );
  }
}

// ---------------------------------------------------------------- grading

export interface GradedTotals {
  score: number;
  correct: number;
  wrong: number;
  attempted: number;
  skipped: number;
  count: number;
  totalMarks: number;
  accuracy: number;
  attemptRate: number;
  percentile: string;
  timeSec: number;
}

/**
 * Grades and finalises an attempt inside one transaction: every response gets its
 * `is_correct`/`marks_awarded`, section rows are written, and the attempt is stamped
 * `submitted`. Idempotent — re-submitting an already-submitted attempt is a no-op.
 */
export async function finaliseAttempt(
  attemptId: string,
  opts: { autoSubmitted: boolean },
): Promise<GradedTotals> {
  return transaction(async (client) => {
    const { rows: attemptRows } = await client.query<AttemptRow & { paper_total: number }>(
      `SELECT a.id, a.user_id, a.paper_id, a.status, a.current_section, a.section_deadline_at,
              a.started_at, a.submitted_at, a.auto_submitted, p.total_marks AS paper_total
         FROM attempts a JOIN papers p ON p.id = a.paper_id
        WHERE a.id = $1 FOR UPDATE`,
      [attemptId],
    );
    const attempt = attemptRows[0];
    if (!attempt) throw notFound('Attempt not found.');

    const { rows: questions } = await client.query<QuestionRow>(
      `SELECT ${QUESTION_SELECT} ${QUESTION_FROM} WHERE q.paper_id = $1 ${QUESTION_ORDER}`,
      [attempt.paper_id],
    );

    const { rows: responses } = await client.query<{
      question_id: string;
      answer: { option: number } | { text: string } | null;
      time_spent_sec: number;
    }>(`SELECT question_id, answer, time_spent_sec FROM responses WHERE attempt_id = $1`, [
      attemptId,
    ]);
    const byQuestion = new Map(responses.map((r) => [r.question_id, r]));

    const perSection = new Map<
      SectionKey,
      {
        count: number;
        attempted: number;
        correct: number;
        wrong: number;
        score: number;
        max: number;
        time: number;
      }
    >();
    for (const s of SECTIONS) {
      perSection.set(s.key, {
        count: 0,
        attempted: 0,
        correct: 0,
        wrong: 0,
        score: 0,
        max: 0,
        time: 0,
      });
    }

    for (const q of questions) {
      const bucket = perSection.get(q.section_key);
      if (!bucket) continue;
      bucket.count += 1;
      bucket.max += Number(q.marks);

      const response = byQuestion.get(q.id);
      bucket.time += response?.time_spent_sec ?? 0;

      const result = grade(
        {
          type: q.type,
          correctOption: q.correct_option,
          titaAnswer: q.tita_answer,
          marks: Number(q.marks),
          negativeMarks: Number(q.negative_marks),
        },
        response?.answer ?? null,
      );

      if (result.attempted) {
        bucket.attempted += 1;
        if (result.isCorrect) bucket.correct += 1;
        else bucket.wrong += 1;
        bucket.score += result.marksAwarded;
      }

      // Persist the grade so review reads never re-derive it.
      await client.query(
        `INSERT INTO responses (attempt_id, question_id, answer, is_correct, marks_awarded)
         VALUES ($1, $2, NULL, $3, $4)
         ON CONFLICT (attempt_id, question_id)
         DO UPDATE SET is_correct = EXCLUDED.is_correct, marks_awarded = EXCLUDED.marks_awarded`,
        [
          attemptId,
          q.id,
          result.attempted ? result.isCorrect : null,
          result.attempted ? result.marksAwarded : null,
        ],
      );
    }

    const totals = [...perSection.values()].reduce(
      (acc, s) => ({
        score: acc.score + s.score,
        correct: acc.correct + s.correct,
        wrong: acc.wrong + s.wrong,
        attempted: acc.attempted + s.attempted,
        count: acc.count + s.count,
        max: acc.max + s.max,
        time: acc.time + s.time,
      }),
      { score: 0, correct: 0, wrong: 0, attempted: 0, count: 0, max: 0, time: 0 },
    );

    const accuracy = totals.attempted ? Math.round((totals.correct / totals.attempted) * 100) : 0;
    const attemptRate = totals.count ? Math.round((totals.attempted / totals.count) * 100) : 0;
    const percentile = estimatePercentileForPaper(totals.score, totals.max || attempt.paper_total);

    // Only stamp submission once; a re-run just refreshes the derived numbers.
    if (attempt.status === 'in_progress') {
      await client.query(
        `UPDATE attempts
            SET status = 'submitted', submitted_at = now(), auto_submitted = $2,
                score = $3, correct = $4, wrong = $5, attempted = $6,
                accuracy = $7, percentile = $8, total_time_sec = $9
          WHERE id = $1`,
        [
          attemptId,
          opts.autoSubmitted,
          totals.score,
          totals.correct,
          totals.wrong,
          totals.attempted,
          accuracy,
          percentile,
          totals.time,
        ],
      );
    }

    for (const section of SECTIONS) {
      const s = perSection.get(section.key)!;
      await client.query(
        `INSERT INTO section_results (attempt_id, section_key, attempted, correct, wrong, skipped,
                                      accuracy, score, max_marks, time_sec)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (attempt_id, section_key) DO UPDATE SET
           attempted = EXCLUDED.attempted, correct = EXCLUDED.correct, wrong = EXCLUDED.wrong,
           skipped = EXCLUDED.skipped, accuracy = EXCLUDED.accuracy, score = EXCLUDED.score,
           max_marks = EXCLUDED.max_marks, time_sec = EXCLUDED.time_sec`,
        [
          attemptId,
          section.key,
          s.attempted,
          s.correct,
          s.wrong,
          s.count - s.attempted,
          s.attempted ? Math.round((s.correct / s.attempted) * 100) : 0,
          s.score,
          s.max,
          s.time,
        ],
      );
    }

    return {
      score: totals.score,
      correct: totals.correct,
      wrong: totals.wrong,
      attempted: totals.attempted,
      skipped: totals.count - totals.attempted,
      count: totals.count,
      totalMarks: totals.max,
      accuracy,
      attemptRate,
      percentile,
      timeSec: totals.time,
    };
  });
}

/**
 * Submits any in-progress attempt whose final deadline has passed. Called opportunistically
 * whenever the owner touches the API, so an abandoned attempt still resolves to a result.
 */
export async function autoSubmitIfExpired(row: AttemptRow): Promise<boolean> {
  if (row.status !== 'in_progress') return false;
  if (!sectionState(row).expired) return false;
  await finaliseAttempt(row.id, { autoSubmitted: true });
  return true;
}

export type DbClient = pg.PoolClient;
