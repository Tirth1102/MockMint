import { Router } from 'express';
import { z } from 'zod';
import {
  DIFFICULTIES,
  SECTIONS,
  fmtShortDate,
  fmtSubmittedAt,
  grade,
  initialsOf,
  sectionConfig,
  type AttemptResult,
  type Difficulty,
  type LeaderboardRow,
  type ResultSummary,
  type ReviewItem,
  type SectionKey,
  type SectionResult,
} from '@mockmint/shared';
import { queryOne, queryRows } from '../../db/pool.js';
import { asyncHandler } from '../../middleware/error.js';
import { requireAuth, currentUser } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { guardUuidParams } from '../../middleware/params.js';
import { forbidden, notFound } from '../../lib/errors.js';
import { QUESTION_FROM, QUESTION_ORDER, QUESTION_SELECT, type QuestionRow } from '../attempts/service.js';
import { buildSuggestions, timeNote } from './suggestions.js';

export const resultsRouter = Router();
resultsRouter.use(requireAuth);
guardUuidParams(resultsRouter, 'id');

interface SubmittedAttemptRow {
  id: string;
  user_id: string;
  paper_id: string;
  status: string;
  submitted_at: Date;
  score: number;
  correct: number;
  wrong: number;
  attempted: number;
  accuracy: number;
  percentile: number;
  total_time_sec: number;
  year: number;
  slot: number;
  title: string;
  total_marks: number;
}

const SUBMITTED_SELECT = `
  a.id, a.user_id, a.paper_id, a.status, a.submitted_at, a.score, a.correct, a.wrong,
  a.attempted, a.accuracy, a.percentile, a.total_time_sec,
  p.year, p.slot, p.title, p.total_marks
`;

async function loadSubmitted(attemptId: string, userId: string): Promise<SubmittedAttemptRow> {
  const row = await queryOne<SubmittedAttemptRow>(
    `SELECT ${SUBMITTED_SELECT} FROM attempts a JOIN papers p ON p.id = a.paper_id WHERE a.id = $1`,
    [attemptId],
  );
  if (!row) throw notFound('Attempt not found.');
  if (row.user_id !== userId) throw forbidden('That attempt belongs to another account.');
  // Answer keys are only ever joined in after submission (ARCHITECTURE.md §6).
  if (row.status === 'in_progress') throw forbidden('This attempt has not been submitted yet.');
  return row;
}

async function buildResult(row: SubmittedAttemptRow): Promise<AttemptResult> {
  const sectionRows = await queryRows<{
    section_key: SectionKey;
    attempted: number;
    correct: number;
    wrong: number;
    skipped: number;
    accuracy: number;
    score: number;
    max_marks: number;
    time_sec: number;
  }>(
    `SELECT section_key, attempted, correct, wrong, skipped, accuracy, score, max_marks, time_sec
       FROM section_results WHERE attempt_id = $1`,
    [row.id],
  );
  const byKey = new Map(sectionRows.map((s) => [s.section_key, s]));

  const sections: SectionResult[] = SECTIONS.map((section) => {
    const s = byKey.get(section.key);
    const count = (s?.attempted ?? 0) + (s?.skipped ?? 0);
    return {
      key: section.key,
      name: section.name,
      count: count || section.count,
      attempted: s?.attempted ?? 0,
      correct: s?.correct ?? 0,
      wrong: s?.wrong ?? 0,
      skipped: s?.skipped ?? section.count,
      acc: Number(s?.accuracy ?? 0),
      score: Number(s?.score ?? 0),
      max: Number(s?.max_marks ?? section.count * 3),
      timeSec: s?.time_sec ?? 0,
    };
  });

  const difficultyRows = await queryRows<{
    difficulty: Difficulty;
    attempted: number;
    correct: number;
  }>(
    `SELECT q.difficulty,
            count(*) FILTER (WHERE r.answer IS NOT NULL)::int              AS attempted,
            count(*) FILTER (WHERE r.is_correct IS TRUE)::int              AS correct
       FROM responses r JOIN questions q ON q.id = r.question_id
      WHERE r.attempt_id = $1
      GROUP BY q.difficulty`,
    [row.id],
  );
  const diffByKey = new Map(difficultyRows.map((d) => [d.difficulty, d]));

  const count = sections.reduce((sum, s) => sum + s.count, 0);
  const totalMarks = sections.reduce((sum, s) => sum + s.max, 0) || row.total_marks;

  return {
    attemptId: row.id,
    paperId: row.paper_id,
    paperName: row.title,
    year: row.year,
    slot: row.slot,
    submittedAt: fmtSubmittedAt(row.submitted_at),
    score: Number(row.score ?? 0),
    totalMarks,
    correct: row.correct ?? 0,
    wrong: row.wrong ?? 0,
    attempted: row.attempted ?? 0,
    skipped: count - (row.attempted ?? 0),
    count,
    accuracy: Number(row.accuracy ?? 0),
    attemptRate: count ? Math.round(((row.attempted ?? 0) / count) * 100) : 0,
    percentile: Number(row.percentile ?? 0).toFixed(2),
    timeSec: row.total_time_sec ?? 0,
    sections,
    difficultyAggregates: DIFFICULTIES.map((difficulty) => ({
      difficulty,
      attempted: diffByKey.get(difficulty)?.attempted ?? 0,
      correct: diffByKey.get(difficulty)?.correct ?? 0,
    })),
  };
}

/** GET /api/attempts/:id/result */
resultsRouter.get(
  '/attempts/:id/result',
  asyncHandler(async (req, res) => {
    const { id: userId } = currentUser(req);
    const row = await loadSubmitted(req.params.id as string, userId);
    const result = await buildResult(row);
    res.json({ result, timeNote: timeNote(result) });
  }),
);

/** GET /api/attempts/:id/review?filter= — answer keys and explanations, post-submission only. */
resultsRouter.get(
  '/attempts/:id/review',
  validate(
    z.object({
      filter: z.enum(['all', 'correct', 'wrong', 'skipped', 'bookmarked']).default('all'),
      limit: z.coerce.number().int().min(1).max(100).default(25),
    }),
    'query',
  ),
  asyncHandler(async (req, res) => {
    const { id: userId } = currentUser(req);
    const row = await loadSubmitted(req.params.id as string, userId);
    const { filter, limit } = req.query as unknown as { filter: string; limit: number };

    const rows = await queryRows<
      QuestionRow & {
        answer: { option: number } | { text: string } | null;
        time_spent_sec: number | null;
        bookmarked: boolean;
      }
    >(
      `SELECT ${QUESTION_SELECT},
              r.answer, r.time_spent_sec,
              (b.user_id IS NOT NULL) AS bookmarked
         ${QUESTION_FROM}
         LEFT JOIN responses r ON r.question_id = q.id AND r.attempt_id = $2
         LEFT JOIN bookmarks b ON b.question_id = q.id AND b.user_id = $3
        WHERE q.paper_id = $1
        ${QUESTION_ORDER}`,
      [row.paper_id, row.id, userId],
    );

    const items: ReviewItem[] = rows.map((q, index) => {
      const graded = grade(
        {
          type: q.type,
          correctOption: q.correct_option,
          titaAnswer: q.tita_answer,
          marks: Number(q.marks),
          negativeMarks: Number(q.negative_marks),
        },
        q.answer,
      );

      return {
        question: {
          id: q.id,
          no: index + 1,
          secNo: q.position,
          sec: q.section_key,
          si: SECTIONS.findIndex((s) => s.key === q.section_key),
          type: q.type,
          topic: q.topic,
          diff: q.difficulty,
          passage: q.passage_body,
          passageLabel: q.passage_label,
          text: q.stem,
          opts: Array.isArray(q.options) ? q.options : [],
          marks: Number(q.marks),
          neg: q.type === 'TITA' ? 0 : Number(q.negative_marks),
          imageUrl: q.image_url,
          answer: q.type === 'MCQ' ? (q.correct_option ?? 0) : (q.tita_answer ?? ''),
          explanation: q.explanation,
        },
        answer: q.answer,
        isCorrect: graded.isCorrect,
        marksAwarded: graded.marksAwarded,
        timeSpentSec: q.time_spent_sec ?? 0,
        bookmarked: q.bookmarked,
      };
    });

    const filtered = items.filter((item) => {
      const attempted = item.answer !== null;
      switch (filter) {
        case 'correct':
          return item.isCorrect;
        case 'wrong':
          return attempted && !item.isCorrect;
        case 'skipped':
          return !attempted;
        case 'bookmarked':
          return item.bookmarked;
        default:
          return true;
      }
    });

    res.json({ items: filtered.slice(0, limit), total: filtered.length, count: items.length });
  }),
);

/** GET /api/attempts/:id/suggestions */
resultsRouter.get(
  '/attempts/:id/suggestions',
  asyncHandler(async (req, res) => {
    const { id: userId } = currentUser(req);
    const row = await loadSubmitted(req.params.id as string, userId);
    const result = await buildResult(row);
    res.json({ suggestions: buildSuggestions(result) });
  }),
);

/** GET /api/results — attempt history, newest last (the trend chart reads it left to right). */
resultsRouter.get(
  '/results',
  validate(
    z.object({
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(50),
    }),
    'query',
  ),
  asyncHandler(async (req, res) => {
    const { id: userId } = currentUser(req);
    const { page, pageSize } = req.query as unknown as { page: number; pageSize: number };

    const rows = await queryRows<SubmittedAttemptRow & { section_scores: number[] }>(
      `SELECT ${SUBMITTED_SELECT},
              COALESCE((
                SELECT array_agg(sr.score ORDER BY array_position(ARRAY['VARC','DILR','QA']::text[], sr.section_key))
                  FROM section_results sr WHERE sr.attempt_id = a.id
              ), ARRAY[]::numeric[]) AS section_scores
         FROM attempts a JOIN papers p ON p.id = a.paper_id
        WHERE a.user_id = $1 AND a.status = 'submitted'
        ORDER BY a.submitted_at ASC
        LIMIT $2 OFFSET $3`,
      [userId, pageSize, (page - 1) * pageSize],
    );

    const total = await queryOne<{ n: number }>(
      `SELECT count(*)::int AS n FROM attempts WHERE user_id = $1 AND status = 'submitted'`,
      [userId],
    );

    const items: ResultSummary[] = rows.map((row) => ({
      attemptId: row.id,
      paperId: row.paper_id,
      name: row.title,
      year: row.year,
      slot: row.slot,
      date: fmtShortDate(row.submitted_at),
      score: Number(row.score ?? 0),
      percentile: Number(row.percentile ?? 0).toFixed(2),
      accuracy: Number(row.accuracy ?? 0),
      sectionScores: (row.section_scores ?? []).map(Number),
    }));

    res.json({ items, total: total?.n ?? items.length, page, pageSize });
  }),
);

/** GET /api/leaderboard — best score per user across the window. */
resultsRouter.get(
  '/leaderboard',
  validate(z.object({ window: z.enum(['month', 'all']).default('month') }), 'query'),
  asyncHandler(async (req, res) => {
    const { id: userId } = currentUser(req);
    const { window } = req.query as unknown as { window: 'month' | 'all' };

    const rows = await queryRows<{
      user_id: string;
      name: string;
      best: number;
      percentile: number;
    }>(
      `SELECT a.user_id, u.name, max(a.score) AS best,
              max(a.percentile) AS percentile
         FROM attempts a JOIN users u ON u.id = a.user_id
        WHERE a.status = 'submitted'
          AND u.blocked_at IS NULL
          AND ($2 = 'all' OR a.submitted_at > now() - interval '1 month')
        GROUP BY a.user_id, u.name
        ORDER BY best DESC
        LIMIT 20`,
      [userId, window],
    );

    const items: LeaderboardRow[] = rows.map((row, i) => ({
      rank: i + 1,
      name: row.name,
      initials: initialsOf(row.name),
      score: Number(row.best ?? 0),
      percentile: Number(row.percentile ?? 0).toFixed(2),
      isSelf: row.user_id === userId,
    }));

    res.json({ items });
  }),
);

export { sectionConfig };
