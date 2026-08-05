import { Router } from 'express';
import { z } from 'zod';
import {
  SECTIONS,
  type Paper,
  type PaperDetail,
  type PaperSlotCard,
  type PaperYearGroup,
  type SectionKey,
} from '@mockmint/shared';
import { queryRows, queryOne } from '../../db/pool.js';
import { asyncHandler } from '../../middleware/error.js';
import { requireAuth, currentUser } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { guardUuidParams } from '../../middleware/params.js';
import { notFound } from '../../lib/errors.js';

export const papersRouter = Router();
papersRouter.use(requireAuth);
guardUuidParams(papersRouter, 'id');

interface PaperRow {
  id: string;
  year: number;
  slot: number;
  title: string;
  duration_min: number;
  total_marks: number;
  difficulty: string;
  status: 'draft' | 'live' | 'retired';
  published_at: Date | null;
  question_count: number;
}

function toPaper(row: PaperRow): Paper {
  return {
    id: row.id,
    year: row.year,
    slot: row.slot,
    title: row.title,
    durationMin: row.duration_min,
    totalMarks: row.total_marks,
    difficulty: row.difficulty,
    status: row.status,
    questionCount: Number(row.question_count),
    publishedAt: row.published_at ? row.published_at.toISOString() : null,
  };
}

/**
 * GET /api/papers — live papers grouped by year, with the caller's best score per slot.
 * Drafts are never returned here; they are visible only through the admin routes.
 */
papersRouter.get(
  '/',
  validate(
    z.object({
      year: z.coerce.number().int().min(2000).max(2100).optional(),
      filter: z.enum(['all', 'recent', 'attempted', 'new']).default('all'),
      q: z.string().trim().max(80).optional(),
    }),
    'query',
  ),
  asyncHandler(async (req, res) => {
    const { id: userId } = currentUser(req);
    const { year, filter, q } = req.query as unknown as {
      year?: number;
      filter: 'all' | 'recent' | 'attempted' | 'new';
      q?: string;
    };

    const rows = await queryRows<PaperRow & { best_score: number | null; section_counts: string }>(
      `SELECT p.id, p.year, p.slot, p.title, p.duration_min, p.total_marks, p.difficulty,
              p.status, p.published_at,
              (SELECT count(*) FROM questions q WHERE q.paper_id = p.id) AS question_count,
              (SELECT max(a.score) FROM attempts a
                WHERE a.paper_id = p.id AND a.user_id = $1 AND a.status = 'submitted') AS best_score,
              (SELECT string_agg(s.key || ' ' || s.question_count, ' · ' ORDER BY s.position)
                 FROM paper_sections s WHERE s.paper_id = p.id) AS section_counts
         FROM papers p
        WHERE p.status = 'live'
          AND ($2::int IS NULL OR p.year = $2)
        ORDER BY p.year DESC, p.slot ASC`,
      [userId, year ?? null],
    );

    const search = q?.toLowerCase().trim();
    const groups = new Map<number, PaperYearGroup>();

    for (const row of rows) {
      if (filter === 'recent' && row.year < 2022) continue;
      if (filter === 'attempted' && row.best_score === null) continue;
      if (filter === 'new' && row.best_score !== null) continue;
      if (search && !`cat ${row.year} slot ${row.slot}`.includes(search)) continue;

      const card: PaperSlotCard = {
        ...toPaper(row),
        bestScore: row.best_score === null ? null : Number(row.best_score),
        pattern: 'MCQ + TITA',
      };

      const existing = groups.get(row.year);
      if (existing) {
        existing.slots.push(card);
      } else {
        groups.set(row.year, {
          year: row.year,
          isNew: row.year >= 2025,
          note: `${row.question_count} questions · ${row.section_counts ?? ''}`,
          slots: [card],
        });
      }
    }

    res.json({ years: [...groups.values()] });
  }),
);

/** GET /api/papers/:id — paper meta + section layout. Never includes questions. */
papersRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const row = await queryOne<PaperRow>(
      `SELECT p.id, p.year, p.slot, p.title, p.duration_min, p.total_marks, p.difficulty,
              p.status, p.published_at,
              (SELECT count(*) FROM questions q WHERE q.paper_id = p.id) AS question_count
         FROM papers p WHERE p.id = $1 AND p.status = 'live'`,
      [req.params.id],
    );
    if (!row) throw notFound('That paper is not available.');

    const sections = await queryRows<{
      key: SectionKey;
      position: number;
      question_count: number;
      duration_min: number;
    }>(
      `SELECT key, position, question_count, duration_min
         FROM paper_sections WHERE paper_id = $1 ORDER BY position`,
      [row.id],
    );

    const titaCount = await queryOne<{ n: number }>(
      `SELECT count(*)::int AS n FROM questions WHERE paper_id = $1 AND type = 'TITA'`,
      [row.id],
    );

    res.json({
      paper: {
        ...toPaper(row),
        sections: sections.map((s) => ({
          key: s.key,
          position: s.position,
          questionCount: s.question_count,
          durationMin: s.duration_min,
        })),
      } satisfies PaperDetail,
      // Drives the "N MCQ / N TITA" line in the pre-exam modal.
      titaCount: titaCount?.n ?? 0,
      sectionOrder: SECTIONS.map((s) => s.key),
    });
  }),
);
