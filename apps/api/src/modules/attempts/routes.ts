import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { SECTIONS, type AttemptPayload, type AttemptResponse } from '@mockmint/shared';
import { config } from '../../config.js';
import { query, queryOne, queryRows } from '../../db/pool.js';
import { asyncHandler } from '../../middleware/error.js';
import { requireAuth, currentUser } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { guardUuidParams } from '../../middleware/params.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import {
  assertWritable,
  autoSubmitIfExpired,
  buildDeadlines,
  examQuestionsFrom,
  finaliseAttempt,
  findActiveAttempt,
  loadAttempt,
  loadExamQuestions,
  sectionState,
  type AttemptRow,
} from './service.js';

export const attemptsRouter = Router();
attemptsRouter.use(requireAuth);
guardUuidParams(attemptsRouter, 'id');

/** 60/min on autosave (ARCHITECTURE.md §6) — generous for typing, tight enough to bound abuse. */
const autosaveLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id ?? req.ip ?? 'anon',
  skip: () => !config.isProd && process.env.DISABLE_RATE_LIMIT === 'true',
});

async function buildPayload(row: AttemptRow): Promise<AttemptPayload> {
  const questionRows = await loadExamQuestions(row.paper_id);
  const questions = examQuestionsFrom(questionRows);

  const responses = await queryRows<{
    question_id: string;
    answer: { option: number } | { text: string } | null;
    marked_for_review: boolean;
    visited: boolean;
    time_spent_sec: number;
  }>(
    `SELECT question_id, answer, marked_for_review, visited, time_spent_sec
       FROM responses WHERE attempt_id = $1`,
    [row.id],
  );

  const paper = await queryOne<{
    id: string;
    year: number;
    slot: number;
    title: string;
    duration_min: number;
    total_marks: number;
    difficulty: string;
    status: 'draft' | 'live' | 'retired';
    published_at: Date | null;
  }>(
    `SELECT id, year, slot, title, duration_min, total_marks, difficulty, status, published_at
       FROM papers WHERE id = $1`,
    [row.paper_id],
  );
  if (!paper) throw notFound('Paper not found.');

  const state = sectionState(row);

  return {
    attempt: {
      id: row.id,
      paperId: row.paper_id,
      paper: {
        id: paper.id,
        year: paper.year,
        slot: paper.slot,
        title: paper.title,
        durationMin: paper.duration_min,
        totalMarks: paper.total_marks,
        difficulty: paper.difficulty,
        status: paper.status,
        questionCount: questions.length,
        publishedAt: paper.published_at ? paper.published_at.toISOString() : null,
      },
      status: row.status,
      currentSection: state.currentSection ?? SECTIONS.length - 1,
      sectionDeadlines: state.deadlines,
      startedAt: new Date(row.started_at).toISOString(),
      submittedAt: row.submitted_at ? new Date(row.submitted_at).toISOString() : null,
      autoSubmitted: row.auto_submitted,
    },
    questions,
    responses: responses.map(
      (r): AttemptResponse => ({
        questionId: r.question_id,
        answer: r.answer,
        markedForReview: r.marked_for_review,
        visited: r.visited,
        timeSpentSec: r.time_spent_sec,
      }),
    ),
    serverNow: new Date().toISOString(),
  };
}

/** POST /api/attempts — start a paper. 409 when an attempt is already in progress. */
attemptsRouter.post(
  '/',
  validate(z.object({ paperId: z.string().uuid() })),
  asyncHandler(async (req, res) => {
    const { id: userId } = currentUser(req);
    const { paperId } = req.body as { paperId: string };

    const existing = await findActiveAttempt(userId);
    if (existing) {
      // An abandoned attempt whose clock ran out resolves itself rather than blocking.
      const submitted = await autoSubmitIfExpired(existing);
      if (!submitted) {
        throw conflict('You already have a test in progress. Resume or submit it first.', {
          attemptId: existing.id,
        });
      }
    }

    const paper = await queryOne<{ id: string }>(
      `SELECT id FROM papers WHERE id = $1 AND status = 'live'`,
      [paperId],
    );
    if (!paper) throw notFound('That paper is not available.');

    const sections = await queryRows<{ duration_min: number }>(
      `SELECT duration_min FROM paper_sections WHERE paper_id = $1 ORDER BY position`,
      [paperId],
    );
    const durations = sections.length
      ? sections.map((s) => s.duration_min)
      : SECTIONS.map((s) => s.mins);

    const startedAt = new Date();
    const deadlines = buildDeadlines(startedAt, durations);

    const created = await queryOne<AttemptRow>(
      `INSERT INTO attempts (user_id, paper_id, status, current_section, section_deadline_at, started_at)
       VALUES ($1, $2, 'in_progress', 0, $3::timestamptz[], $4)
       RETURNING id, user_id, paper_id, status, current_section, section_deadline_at,
                 started_at, submitted_at, auto_submitted`,
      [userId, paperId, deadlines.map((d) => d.toISOString()), startedAt],
    );
    if (!created) throw badRequest('Could not start the attempt.');

    // Mark the opening question visited so the palette matches the prototype on load.
    await query(
      `INSERT INTO responses (attempt_id, question_id, visited)
       SELECT $1, q.id, true FROM questions q
        WHERE q.paper_id = $2 AND q.section_key = 'VARC' AND q.position = 1`,
      [created.id, paperId],
    );

    res.status(201).json(await buildPayload(created));
  }),
);

/** GET /api/attempts/active — resume payload, or 204 when there is nothing to resume. */
attemptsRouter.get(
  '/active',
  asyncHandler(async (req, res) => {
    const { id: userId } = currentUser(req);
    const row = await findActiveAttempt(userId);
    if (!row) {
      res.status(204).end();
      return;
    }
    if (await autoSubmitIfExpired(row)) {
      res.status(200).json({ expired: true, attemptId: row.id });
      return;
    }
    res.json(await buildPayload(row));
  }),
);

/**
 * PATCH /api/attempts/:id/response — autosave. Idempotent: the client may replay the
 * same payload safely, and `timeSpentSec` is accumulated monotonically so a stale
 * retry can never reduce recorded time.
 */
attemptsRouter.patch(
  '/:id/response',
  autosaveLimiter,
  validate(
    z.object({
      questionId: z.string().uuid(),
      answer: z
        .union([
          z.object({ option: z.number().int().min(0).max(3) }),
          z.object({ text: z.string().max(120) }),
        ])
        .nullable()
        .optional(),
      markedForReview: z.boolean().optional(),
      visited: z.boolean().optional(),
      timeSpentSec: z.number().int().min(0).max(60 * 60 * 4).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const { id: userId } = currentUser(req);
    const attempt = await loadAttempt(req.params.id as string, userId);
    const body = req.body as {
      questionId: string;
      answer?: { option: number } | { text: string } | null;
      markedForReview?: boolean;
      visited?: boolean;
      timeSpentSec?: number;
    };

    const question = await queryOne<{ section_key: 'VARC' | 'DILR' | 'QA'; type: string }>(
      `SELECT section_key, type FROM questions WHERE id = $1 AND paper_id = $2`,
      [body.questionId, attempt.paper_id],
    );
    if (!question) throw notFound('That question is not part of this paper.');

    assertWritable(attempt, question.section_key);

    if (question.type === 'TITA' && body.answer && 'option' in body.answer) {
      throw badRequest('TITA questions take a typed answer, not an option index.');
    }
    if (question.type === 'MCQ' && body.answer && 'text' in body.answer) {
      throw badRequest('MCQ questions take an option index, not typed text.');
    }

    await query(
      `INSERT INTO responses (attempt_id, question_id, answer, marked_for_review, visited,
                              time_spent_sec, updated_at)
       VALUES ($1, $2, $3::jsonb, COALESCE($4, false), COALESCE($5, true), COALESCE($6, 0), now())
       ON CONFLICT (attempt_id, question_id) DO UPDATE SET
         answer            = CASE WHEN $7::bool THEN EXCLUDED.answer ELSE responses.answer END,
         marked_for_review = COALESCE($4, responses.marked_for_review),
         visited           = responses.visited OR COALESCE($5, true),
         time_spent_sec    = GREATEST(responses.time_spent_sec, COALESCE($6, 0)),
         updated_at        = now()`,
      [
        attempt.id,
        body.questionId,
        body.answer ? JSON.stringify(body.answer) : null,
        body.markedForReview ?? null,
        body.visited ?? null,
        body.timeSpentSec ?? null,
        // Only overwrite the stored answer when the client actually sent the field —
        // a heartbeat that omits `answer` must not clear a saved response.
        Object.prototype.hasOwnProperty.call(body, 'answer'),
      ],
    );

    res.json({ saved: true, serverNow: new Date().toISOString() });
  }),
);

/** POST /api/attempts/:id/section — validates a section switch against the server clock. */
attemptsRouter.post(
  '/:id/section',
  validate(z.object({ sectionKey: z.enum(['VARC', 'DILR', 'QA']) })),
  asyncHandler(async (req, res) => {
    const { id: userId } = currentUser(req);
    const attempt = await loadAttempt(req.params.id as string, userId);
    const { sectionKey } = req.body as { sectionKey: 'VARC' | 'DILR' | 'QA' };

    if (await autoSubmitIfExpired(attempt)) {
      res.json({ expired: true, attemptId: attempt.id });
      return;
    }

    assertWritable(attempt, sectionKey);
    const index = SECTIONS.findIndex((s) => s.key === sectionKey);
    await query(`UPDATE attempts SET current_section = $2 WHERE id = $1`, [attempt.id, index]);

    const state = sectionState(attempt);
    res.json({ currentSection: index, remaining: state.remaining, serverNow: new Date().toISOString() });
  }),
);

/** GET /api/attempts/:id/clock — cheap poll so a long-idle tab resyncs to server time. */
attemptsRouter.get(
  '/:id/clock',
  asyncHandler(async (req, res) => {
    const { id: userId } = currentUser(req);
    const attempt = await loadAttempt(req.params.id as string, userId);
    const state = sectionState(attempt);
    if (attempt.status === 'in_progress' && state.expired) {
      await finaliseAttempt(attempt.id, { autoSubmitted: true });
      res.json({ expired: true, remaining: [0, 0, 0], serverNow: new Date().toISOString() });
      return;
    }
    res.json({
      expired: state.expired,
      currentSection: state.currentSection,
      remaining: state.remaining,
      serverNow: new Date().toISOString(),
    });
  }),
);

/** POST /api/attempts/:id/submit — grade and finalise. */
attemptsRouter.post(
  '/:id/submit',
  validate(z.object({ reason: z.enum(['manual', 'timeup']).default('manual') })),
  asyncHandler(async (req, res) => {
    const { id: userId } = currentUser(req);
    const attempt = await loadAttempt(req.params.id as string, userId);
    const { reason } = req.body as { reason: 'manual' | 'timeup' };

    if (attempt.status !== 'in_progress') {
      res.json({ attemptId: attempt.id, alreadySubmitted: true });
      return;
    }

    const totals = await finaliseAttempt(attempt.id, {
      autoSubmitted: reason === 'timeup' || sectionState(attempt).expired,
    });

    res.json({ attemptId: attempt.id, ...totals });
  }),
);
