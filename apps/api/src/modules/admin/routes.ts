import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import {
  DIFFICULTIES,
  SECTIONS,
  initialsOf,
  type AdminAnalytics,
  type AdminOverview,
  type AdminQuestion,
  type AdminUserRow,
  type Difficulty,
  type SectionKey,
} from '@mockmint/shared';
import { query, queryOne, queryRows, transaction } from '../../db/pool.js';
import { asyncHandler } from '../../middleware/error.js';
import { requireAuth, requireAdmin, currentUser } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { guardUuidParams } from '../../middleware/params.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { hashPassword } from '../auth/password.js';
import { revokeAllForUser } from '../auth/tokens.js';
import { detectFormat, parseFile, validateRows, type ParsedQuestion } from './upload.js';

export const adminRouter = Router();
adminRouter.use(requireAuth, requireAdmin);
guardUuidParams(adminRouter, 'id', 'jobId');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

/** Every mutating admin action lands in the audit log (ARCHITECTURE.md §6). */
async function audit(
  adminId: string,
  action: string,
  target: string | null,
  detail: unknown = {},
): Promise<void> {
  await query(
    `INSERT INTO admin_audit_log (admin_id, action, target, detail) VALUES ($1,$2,$3,$4::jsonb)`,
    [adminId, action, target, JSON.stringify(detail)],
  );
}

// ---------------------------------------------------------------- overview

adminRouter.get(
  '/overview',
  asyncHandler(async (_req, res) => {
    const totals = await queryOne<{
      users: number;
      active: number;
      papers_live: number;
      papers_draft: number;
      questions: number;
      attempts: number;
      avg_score: number | null;
    }>(
      `SELECT (SELECT count(*)::int FROM users WHERE role = 'student')                       AS users,
              (SELECT count(DISTINCT user_id)::int FROM attempts
                WHERE started_at > now() - interval '7 days')                                AS active,
              (SELECT count(*)::int FROM papers WHERE status = 'live')                       AS papers_live,
              (SELECT count(*)::int FROM papers WHERE status = 'draft')                      AS papers_draft,
              (SELECT count(*)::int FROM questions)                                          AS questions,
              (SELECT count(*)::int FROM attempts WHERE status = 'submitted')                AS attempts,
              (SELECT avg(score) FROM attempts WHERE status = 'submitted')                   AS avg_score`,
    );

    const growth = await queryRows<{ label: string; value: number }>(
      `SELECT to_char(month, 'Mon') AS label, count(u.id)::int AS value
         FROM generate_series(date_trunc('month', now()) - interval '11 months',
                              date_trunc('month', now()), interval '1 month') AS month
         LEFT JOIN users u ON date_trunc('month', u.created_at) = month
        GROUP BY month ORDER BY month`,
    );

    const topPapers = await queryRows<{ name: string; attempts: number }>(
      `SELECT p.title AS name, count(a.id)::int AS attempts
         FROM papers p LEFT JOIN attempts a ON a.paper_id = p.id AND a.status = 'submitted'
        GROUP BY p.id, p.title ORDER BY attempts DESC LIMIT 5`,
    );

    const difficulty = await queryRows<{ label: Difficulty; pct: number; total: number }>(
      `SELECT q.difficulty AS label,
              COALESCE(round(
                100.0 * count(*) FILTER (WHERE r.is_correct) /
                NULLIF(count(*) FILTER (WHERE r.answer IS NOT NULL), 0)
              ), 0)::int AS pct,
              (SELECT count(*)::int FROM questions q2 WHERE q2.difficulty = q.difficulty) AS total
         FROM questions q LEFT JOIN responses r ON r.question_id = q.id
        GROUP BY q.difficulty`,
    );
    const diffByKey = new Map(difficulty.map((d) => [d.label, d]));

    const payload: AdminOverview = {
      stats: [
        {
          label: 'Total users',
          value: (totals?.users ?? 0).toLocaleString('en-IN'),
          delta: 'students registered',
          tone: 'muted',
        },
        {
          label: 'Active (7d)',
          value: (totals?.active ?? 0).toLocaleString('en-IN'),
          delta: totals?.users
            ? `${Math.round(((totals.active ?? 0) / totals.users) * 100)}% of base`
            : '—',
          tone: 'muted',
        },
        {
          label: 'Papers live',
          value: String(totals?.papers_live ?? 0),
          delta: `${totals?.papers_draft ?? 0} in draft`,
          tone: 'muted',
        },
        {
          label: 'Questions',
          value: (totals?.questions ?? 0).toLocaleString('en-IN'),
          delta: 'across all banks',
          tone: 'ok',
        },
        {
          label: 'Tests attempted',
          value: (totals?.attempts ?? 0).toLocaleString('en-IN'),
          delta: 'submitted attempts',
          tone: 'ok',
        },
        {
          label: 'Average score',
          value: totals?.avg_score === null || totals?.avg_score === undefined
            ? '—'
            : Number(totals.avg_score).toFixed(1),
          delta: 'across all attempts',
          tone: 'muted',
        },
      ],
      growth,
      topPapers,
      difficulty: DIFFICULTIES.map((label) => ({
        label,
        pct: diffByKey.get(label)?.pct ?? 0,
        note: `${(diffByKey.get(label)?.total ?? 0).toLocaleString('en-IN')} questions tagged ${label}`,
      })),
    };

    res.json(payload);
  }),
);

// ---------------------------------------------------------------- analytics

adminRouter.get(
  '/analytics',
  asyncHandler(async (_req, res) => {
    const dau = await queryRows<{ value: number }>(
      `SELECT count(DISTINCT a.user_id)::int AS value
         FROM generate_series(current_date - 13, current_date, interval '1 day') AS d
         LEFT JOIN attempts a ON a.started_at::date = d::date
        GROUP BY d ORDER BY d`,
    );

    const completion = await queryRows<{ label: SectionKey; pct: number }>(
      `SELECT sr.section_key AS label,
              COALESCE(round(100.0 * count(*) FILTER (WHERE sr.skipped = 0) /
                NULLIF(count(*), 0)), 0)::int AS pct
         FROM section_results sr GROUP BY sr.section_key`,
    );
    const completionByKey = new Map(completion.map((c) => [c.label, c.pct]));

    const yearAverages = await queryRows<{ year: number; avg: number }>(
      `SELECT p.year, COALESCE(round(avg(a.score)), 0)::int AS avg
         FROM papers p LEFT JOIN attempts a ON a.paper_id = p.id AND a.status = 'submitted'
        GROUP BY p.year ORDER BY p.year`,
    );

    const payload: AdminAnalytics = {
      dau: dau.map((d) => d.value),
      completion: SECTIONS.map((s) => ({
        label: `${s.key} · completed all ${s.count}`,
        pct: completionByKey.get(s.key) ?? 0,
      })),
      yearAverages,
    };
    res.json(payload);
  }),
);

// ---------------------------------------------------------------- questions

interface AdminQuestionRow {
  id: string;
  code: string;
  paper_id: string;
  section_key: SectionKey;
  position: number;
  type: 'MCQ' | 'TITA';
  topic: string;
  difficulty: Difficulty;
  passage_id: string | null;
  stem: string;
  options: string[];
  correct_option: number | null;
  tita_answer: string | null;
  explanation: string;
  marks: number;
  negative_marks: number;
  image_url: string | null;
}

function toAdminQuestion(row: AdminQuestionRow): AdminQuestion {
  return {
    id: row.id,
    code: row.code,
    paperId: row.paper_id,
    sec: row.section_key,
    position: row.position,
    type: row.type,
    topic: row.topic,
    diff: row.difficulty,
    passageId: row.passage_id,
    text: row.stem,
    opts: Array.isArray(row.options) ? row.options : [],
    correctOption: row.correct_option,
    titaAnswer: row.tita_answer,
    explanation: row.explanation,
    marks: Number(row.marks),
    neg: Number(row.negative_marks),
    imageUrl: row.image_url,
  };
}

const ADMIN_QUESTION_COLUMNS = `
  id, code, paper_id, section_key, position, type, topic, difficulty, passage_id, stem,
  options, correct_option, tita_answer, explanation, marks, negative_marks, image_url
`;

adminRouter.get(
  '/questions',
  validate(
    z.object({
      paperId: z.string().uuid(),
      section: z.enum(['all', 'VARC', 'DILR', 'QA']).default('all'),
      q: z.string().trim().max(120).optional(),
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(14),
    }),
    'query',
  ),
  asyncHandler(async (req, res) => {
    const { paperId, section, q, page, pageSize } = req.query as unknown as {
      paperId: string;
      section: 'all' | SectionKey;
      q?: string;
      page: number;
      pageSize: number;
    };

    const search = q ? `%${q.toLowerCase()}%` : null;
    const filters = `
      WHERE paper_id = $1
        AND ($2 = 'all' OR section_key = $2)
        AND ($3::text IS NULL OR lower(stem || ' ' || topic || ' ' || code) LIKE $3)
    `;

    const rows = await queryRows<AdminQuestionRow>(
      `SELECT ${ADMIN_QUESTION_COLUMNS} FROM questions
       ${filters}
       ORDER BY array_position(ARRAY['VARC','DILR','QA']::text[], section_key), position
       LIMIT $4 OFFSET $5`,
      [paperId, section, search, pageSize, (page - 1) * pageSize],
    );

    const total = await queryOne<{ n: number }>(
      `SELECT count(*)::int AS n FROM questions ${filters}`,
      [paperId, section, search],
    );

    const counts = await queryRows<{ section_key: SectionKey; n: number }>(
      `SELECT section_key, count(*)::int AS n FROM questions WHERE paper_id = $1 GROUP BY section_key`,
      [paperId],
    );
    const countByKey = new Map(counts.map((c) => [c.section_key, c.n]));

    res.json({
      items: rows.map(toAdminQuestion),
      total: total?.n ?? 0,
      page,
      pageSize,
      bankCounts: SECTIONS.map((s) => ({ key: s.key, count: countByKey.get(s.key) ?? 0 })),
      bankTotal: [...countByKey.values()].reduce((a, b) => a + b, 0),
    });
  }),
);

const questionBodySchema = z
  .object({
    paperId: z.string().uuid(),
    sec: z.enum(['VARC', 'DILR', 'QA']),
    type: z.enum(['MCQ', 'TITA']),
    diff: z.enum(['Easy', 'Medium', 'Hard']),
    topic: z.string().trim().max(120).default(''),
    text: z.string().trim().min(1, 'Question stem cannot be empty'),
    opts: z.array(z.string()).max(4).default([]),
    correctOption: z.number().int().min(0).max(3).nullable().default(null),
    titaAnswer: z.string().trim().max(120).nullable().default(null),
    explanation: z.string().default(''),
    marks: z.coerce.number().min(0).max(20).default(3),
    neg: z.coerce.number().min(0).max(20).default(1),
  })
  .superRefine((value, ctx) => {
    if (value.type === 'MCQ') {
      if (value.opts.filter((o) => o.trim()).length < 4) {
        ctx.addIssue({ code: 'custom', message: 'All four options are required', path: ['opts'] });
      }
      if (value.correctOption === null) {
        ctx.addIssue({
          code: 'custom',
          message: 'Mark one option as correct',
          path: ['correctOption'],
        });
      }
    } else if (!value.titaAnswer?.trim()) {
      ctx.addIssue({ code: 'custom', message: 'TITA answer is required', path: ['titaAnswer'] });
    }
  });

adminRouter.post(
  '/questions',
  validate(questionBodySchema),
  asyncHandler(async (req, res) => {
    const { id: adminId } = currentUser(req);
    const body = req.body as z.infer<typeof questionBodySchema>;

    const next = await queryOne<{ position: number }>(
      `SELECT COALESCE(max(position), 0) + 1 AS position
         FROM questions WHERE paper_id = $1 AND section_key = $2`,
      [body.paperId, body.sec],
    );
    const position = next?.position ?? 1;

    const row = await queryOne<AdminQuestionRow>(
      `INSERT INTO questions (paper_id, code, section_key, position, type, stem, options,
                              correct_option, tita_answer, explanation, difficulty, topic,
                              marks, negative_marks)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13, $14)
       RETURNING ${ADMIN_QUESTION_COLUMNS}`,
      [
        body.paperId,
        `${body.sec}-N${Date.now().toString(36).toUpperCase()}`,
        body.sec,
        position,
        body.type,
        body.text,
        JSON.stringify(body.type === 'MCQ' ? body.opts : []),
        body.type === 'MCQ' ? body.correctOption : null,
        body.type === 'TITA' ? body.titaAnswer : null,
        body.explanation,
        body.diff,
        body.topic,
        body.marks,
        body.type === 'TITA' ? 0 : body.neg,
      ],
    );
    if (!row) throw badRequest('Could not create the question.');

    await audit(adminId, 'question.create', row.id, { paperId: body.paperId });
    res.status(201).json({ question: toAdminQuestion(row) });
  }),
);

adminRouter.patch(
  '/questions/:id',
  validate(questionBodySchema.innerType().partial().omit({ paperId: true })),
  asyncHandler(async (req, res) => {
    const { id: adminId } = currentUser(req);
    const body = req.body as Partial<z.infer<typeof questionBodySchema>>;

    const existing = await queryOne<AdminQuestionRow>(
      `SELECT ${ADMIN_QUESTION_COLUMNS} FROM questions WHERE id = $1`,
      [req.params.id],
    );
    if (!existing) throw notFound('Question not found.');

    const type = body.type ?? existing.type;
    const row = await queryOne<AdminQuestionRow>(
      `UPDATE questions SET
         section_key    = COALESCE($2, section_key),
         type           = COALESCE($3, type),
         stem           = COALESCE($4, stem),
         options        = COALESCE($5::jsonb, options),
         correct_option = $6,
         tita_answer    = $7,
         explanation    = COALESCE($8, explanation),
         difficulty     = COALESCE($9, difficulty),
         topic          = COALESCE($10, topic),
         marks          = COALESCE($11, marks),
         negative_marks = COALESCE($12, negative_marks)
       WHERE id = $1
       RETURNING ${ADMIN_QUESTION_COLUMNS}`,
      [
        req.params.id,
        body.sec ?? null,
        body.type ?? null,
        body.text ?? null,
        body.opts ? JSON.stringify(type === 'MCQ' ? body.opts : []) : null,
        type === 'MCQ' ? (body.correctOption ?? existing.correct_option) : null,
        type === 'TITA' ? (body.titaAnswer ?? existing.tita_answer) : null,
        body.explanation ?? null,
        body.diff ?? null,
        body.topic ?? null,
        body.marks ?? null,
        type === 'TITA' ? 0 : (body.neg ?? null),
      ],
    );
    if (!row) throw notFound('Question not found.');

    await audit(adminId, 'question.update', row.id);
    res.json({ question: toAdminQuestion(row) });
  }),
);

adminRouter.delete(
  '/questions/:id',
  asyncHandler(async (req, res) => {
    const { id: adminId } = currentUser(req);
    const result = await query(`DELETE FROM questions WHERE id = $1`, [req.params.id]);
    if (!result.rowCount) throw notFound('Question not found.');
    await audit(adminId, 'question.delete', req.params.id ?? null);
    res.status(204).end();
  }),
);

// ---------------------------------------------------------------- papers

adminRouter.get(
  '/papers',
  asyncHandler(async (_req, res) => {
    const rows = await queryRows<{
      id: string;
      year: number;
      slot: number;
      title: string;
      difficulty: string;
      duration_min: number;
      status: 'draft' | 'live' | 'retired';
      questions: number;
      attempts: number;
    }>(
      `SELECT p.id, p.year, p.slot, p.title, p.difficulty, p.duration_min, p.status,
              (SELECT count(*)::int FROM questions q WHERE q.paper_id = p.id)  AS questions,
              (SELECT count(*)::int FROM attempts a
                WHERE a.paper_id = p.id AND a.status = 'submitted')            AS attempts
         FROM papers p ORDER BY p.year DESC, p.slot ASC`,
    );

    res.json({
      items: rows.map((r) => ({
        id: r.id,
        year: r.year,
        slot: r.slot,
        name: r.title,
        meta: `${r.difficulty} · ${r.duration_min} min`,
        questions: r.questions,
        attempts: r.attempts,
        status: r.status,
        // Only a paper nobody has sat can be deleted; the rest must be retired.
        canDelete: r.attempts === 0,
      })),
    });
  }),
);

const paperBodySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  slot: z.coerce.number().int().min(1).max(4),
  durationMin: z.coerce.number().int().min(30).max(300).default(120),
  sectionLockMin: z.coerce.number().int().min(5).max(120).default(40),
  difficulty: z.string().trim().min(1).max(40).default('Moderate'),
  status: z.enum(['draft', 'live']).default('draft'),
});

adminRouter.post(
  '/papers',
  validate(paperBodySchema),
  asyncHandler(async (req, res) => {
    const { id: adminId } = currentUser(req);
    const body = req.body as z.infer<typeof paperBodySchema>;

    if (body.sectionLockMin * SECTIONS.length > body.durationMin) {
      throw badRequest(
        `Three sectional locks of ${body.sectionLockMin} min do not fit in ${body.durationMin} min.`,
      );
    }

    const clash = await queryOne<{ id: string }>(
      `SELECT id FROM papers WHERE year = $1 AND slot = $2`,
      [body.year, body.slot],
    );
    if (clash) {
      throw conflict(`CAT ${body.year} Slot ${body.slot} already exists. Change the year or slot.`);
    }

    const paper = await transaction(async (client) => {
      const { rows } = await client.query<{ id: string; title: string }>(
        `INSERT INTO papers (year, slot, title, duration_min, total_marks, difficulty, status,
                             published_at, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $7 = 'live' THEN now() END, $8)
         RETURNING id, title`,
        [
          body.year,
          body.slot,
          `CAT ${body.year} — Slot ${body.slot}`,
          body.durationMin,
          SECTIONS.reduce((sum, s) => sum + s.count, 0) * 3,
          body.difficulty,
          body.status,
          adminId,
        ],
      );
      const created = rows[0]!;

      for (const [position, section] of SECTIONS.entries()) {
        await client.query(
          `INSERT INTO paper_sections (paper_id, key, position, question_count, duration_min)
           VALUES ($1, $2, $3, $4, $5)`,
          [created.id, section.key, position, section.count, body.sectionLockMin],
        );
      }
      return created;
    });

    await audit(adminId, `paper.${body.status === 'live' ? 'publish' : 'draft'}`, paper.id, body);
    res.status(201).json({
      paper,
      message:
        body.status === 'live'
          ? `CAT ${body.year} Slot ${body.slot} published — now live on the student Papers page`
          : `CAT ${body.year} Slot ${body.slot} saved as a draft — hidden from students`,
    });
  }),
);

adminRouter.post(
  '/papers/:id/publish',
  asyncHandler(async (req, res) => {
    const { id: adminId } = currentUser(req);
    const row = await queryOne<{ id: string; title: string }>(
      `UPDATE papers SET status = 'live', published_at = COALESCE(published_at, now())
        WHERE id = $1 RETURNING id, title`,
      [req.params.id],
    );
    if (!row) throw notFound('Paper not found.');
    await audit(adminId, 'paper.publish', row.id);
    res.json({ paper: row, message: `${row.title} published` });
  }),
);

adminRouter.post(
  '/papers/:id/unpublish',
  asyncHandler(async (req, res) => {
    const { id: adminId } = currentUser(req);
    const row = await queryOne<{ id: string; title: string }>(
      `UPDATE papers SET status = 'draft' WHERE id = $1 RETURNING id, title`,
      [req.params.id],
    );
    if (!row) throw notFound('Paper not found.');
    await audit(adminId, 'paper.unpublish', row.id);
    res.json({ paper: row, message: `${row.title} unpublished` });
  }),
);

adminRouter.delete(
  '/papers/:id',
  asyncHandler(async (req, res) => {
    const { id: adminId } = currentUser(req);
    const attempts = await queryOne<{ n: number }>(
      `SELECT count(*)::int AS n FROM attempts WHERE paper_id = $1`,
      [req.params.id],
    );
    // Deleting would cascade real attempt history away — retire it instead.
    if ((attempts?.n ?? 0) > 0) {
      throw conflict('This paper has recorded attempts. Unpublish it instead of deleting.');
    }
    const result = await query(`DELETE FROM papers WHERE id = $1`, [req.params.id]);
    if (!result.rowCount) throw notFound('Paper not found.');
    await audit(adminId, 'paper.delete', req.params.id ?? null);
    res.status(204).end();
  }),
);

// ---------------------------------------------------------------- bulk upload

adminRouter.post(
  '/uploads',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const { id: adminId } = currentUser(req);
    const paperId = (req.body?.paperId as string | undefined) ?? null;
    if (!req.file) throw badRequest('Attach a file under the `file` field.');
    if (!paperId) throw badRequest('Choose the paper to import into.');

    const format = detectFormat(req.file.originalname);
    const rows = await parseFile(req.file.buffer, format);
    if (rows.length === 0) throw badRequest('That file has no data rows.');
    if (rows.length > 2000) throw badRequest('Up to 2,000 rows per upload.');

    const outcome = validateRows(rows);

    const job = await queryOne<{ id: string }>(
      `INSERT INTO upload_jobs (admin_id, paper_id, filename, format, total_rows, valid_rows,
                                warnings, errors, parsed, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,'validated')
       RETURNING id`,
      [
        adminId,
        paperId,
        req.file.originalname,
        format,
        outcome.totalRows,
        outcome.validRows,
        JSON.stringify(outcome.rows.filter((r) => r.status === 'WARN')),
        JSON.stringify(outcome.rows.filter((r) => r.status === 'ERROR')),
        JSON.stringify(outcome.parsed),
      ],
    );

    await audit(adminId, 'upload.validate', job?.id ?? null, {
      filename: req.file.originalname,
      totalRows: outcome.totalRows,
    });

    res.status(201).json({
      jobId: job?.id,
      filename: req.file.originalname,
      format,
      totalRows: outcome.totalRows,
      validRows: outcome.validRows,
      warnings: outcome.warnings,
      errors: outcome.errors,
      rows: outcome.rows,
    });
  }),
);

/** Returns a pre-filled .xlsx template the admin can fill in and re-upload. */
adminRouter.get(
  '/uploads/template',
  asyncHandler(async (_req, res) => {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'MockMint';
    const sheet = workbook.addWorksheet('Questions');

    sheet.columns = [
      { header: 'section', key: 'section', width: 10 },
      { header: 'type', key: 'type', width: 8 },
      { header: 'passage_id', key: 'passage_id', width: 12 },
      { header: 'stem', key: 'stem', width: 45 },
      { header: 'option_a', key: 'option_a', width: 22 },
      { header: 'option_b', key: 'option_b', width: 22 },
      { header: 'option_c', key: 'option_c', width: 22 },
      { header: 'option_d', key: 'option_d', width: 22 },
      { header: 'correct', key: 'correct', width: 10 },
      { header: 'explanation', key: 'explanation', width: 35 },
      { header: 'difficulty', key: 'difficulty', width: 12 },
      { header: 'topic', key: 'topic', width: 22 },
      { header: 'marks', key: 'marks', width: 8 },
      { header: 'negative', key: 'negative', width: 10 },
    ];

    // Style header row
    const headerRow = sheet.getRow(1);
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB0501E' } };
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };

    // MCQ example row
    sheet.addRow({
      section: 'VARC', type: 'MCQ', passage_id: '',
      stem: "Which of the following best describes the author's tone in the passage?",
      option_a: 'Cynical and dismissive', option_b: 'Analytical and detached',
      option_c: 'Hopeful and optimistic', option_d: 'Nostalgic and sentimental',
      correct: 'B', explanation: 'The author uses objective analysis without emotional language.',
      difficulty: 'Medium', topic: 'Reading Comprehension', marks: 3, negative: 1,
    });

    // TITA example row
    sheet.addRow({
      section: 'QA', type: 'TITA', passage_id: '',
      stem: 'If the ratio of A to B is 3:4 and the ratio of B to C is 2:5, find A:C.',
      option_a: '', option_b: '', option_c: '', option_d: '',
      correct: '3:10', explanation: 'A:B = 3:4, B:C = 2:5, so A:C = 6:20 = 3:10',
      difficulty: 'Hard', topic: 'Ratios & Proportions', marks: 3, negative: 0,
    });

    // DILR MCQ example
    sheet.addRow({
      section: 'DILR', type: 'MCQ', passage_id: 'set1',
      stem: 'Based on the table, which month had the highest sales?',
      option_a: 'January', option_b: 'March', option_c: 'June', option_d: 'September',
      correct: 'C', explanation: 'June recorded 4,200 units vs all others below 4,000.',
      difficulty: 'Easy', topic: 'Data Interpretation · Tables', marks: 3, negative: 1,
    });

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="mockmint-questions-template.xlsx"',
    );

    await workbook.xlsx.write(res);
    res.end();
  }),
);

adminRouter.get(
  '/uploads/:jobId',
  asyncHandler(async (req, res) => {
    const row = await queryOne<{
      id: string;
      filename: string;
      format: string;
      total_rows: number;
      valid_rows: number;
      warnings: unknown[];
      errors: unknown[];
      status: string;
    }>(
      `SELECT id, filename, format, total_rows, valid_rows, warnings, errors, status
         FROM upload_jobs WHERE id = $1`,
      [req.params.jobId],
    );
    if (!row) throw notFound('Upload job not found.');
    res.json({
      jobId: row.id,
      filename: row.filename,
      format: row.format,
      totalRows: row.total_rows,
      validRows: row.valid_rows,
      warnings: row.warnings,
      errors: row.errors,
      status: row.status,
    });
  }),
);

/** Commits the valid rows. The whole job is one transaction (ARCHITECTURE.md §5). */
adminRouter.post(
  '/uploads/:jobId/commit',
  asyncHandler(async (req, res) => {
    const { id: adminId } = currentUser(req);

    const job = await queryOne<{
      id: string;
      paper_id: string | null;
      parsed: ParsedQuestion[];
      status: string;
      total_rows: number;
      valid_rows: number;
    }>(
      `SELECT id, paper_id, parsed, status, total_rows, valid_rows
         FROM upload_jobs WHERE id = $1 AND admin_id = $2`,
      [req.params.jobId, adminId],
    );
    if (!job) throw notFound('Upload job not found.');
    if (job.status !== 'validated') throw conflict('That upload has already been resolved.');
    if (!job.paper_id) throw badRequest('This job has no target paper.');

    const paperId = job.paper_id;
    const imported = await transaction(async (client) => {
      // Passage refs inside one upload map to one passage row each.
      const passageIds = new Map<string, string>();
      let count = 0;

      for (const q of job.parsed) {
        const { rows: posRows } = await client.query<{ position: number }>(
          `SELECT COALESCE(max(position), 0) + 1 AS position
             FROM questions WHERE paper_id = $1 AND section_key = $2`,
          [paperId, q.sectionKey],
        );
        const position = posRows[0]?.position ?? 1;

        let passageId: string | null = null;
        if (q.passageRef) {
          const cached = passageIds.get(q.passageRef);
          if (cached) {
            passageId = cached;
          } else {
            const { rows } = await client.query<{ id: string }>(
              `INSERT INTO passages (paper_id, section_key, body, label)
               VALUES ($1, $2, $3, $4) RETURNING id`,
              [paperId, q.sectionKey, `Imported set ${q.passageRef}`, q.passageRef],
            );
            passageId = rows[0]!.id;
            passageIds.set(q.passageRef, passageId);
          }
        }

        await client.query(
          `INSERT INTO questions (paper_id, code, section_key, position, passage_id, type, stem,
                                  options, correct_option, tita_answer, explanation, difficulty,
                                  topic, marks, negative_marks)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14,$15)`,
          [
            paperId,
            `${q.sectionKey}-U${Date.now().toString(36).toUpperCase()}${count}`,
            q.sectionKey,
            position,
            passageId,
            q.type,
            q.stem,
            JSON.stringify(q.options),
            q.correctOption,
            q.titaAnswer,
            q.explanation,
            q.difficulty,
            q.topic,
            q.marks,
            q.negativeMarks,
          ],
        );
        count++;
      }

      await client.query(`UPDATE upload_jobs SET status = 'committed' WHERE id = $1`, [job.id]);
      return count;
    });

    await audit(adminId, 'upload.commit', job.id, { imported });
    const rejected = job.total_rows - job.valid_rows;
    res.json({
      imported,
      rejected,
      message: `${imported} questions imported${rejected ? ` · ${rejected} rows rejected` : ''}`,
    });
  }),
);

adminRouter.delete(
  '/uploads/:jobId',
  asyncHandler(async (req, res) => {
    const { id: adminId } = currentUser(req);
    await query(`UPDATE upload_jobs SET status = 'discarded' WHERE id = $1 AND admin_id = $2`, [
      req.params.jobId,
      adminId,
    ]);
    res.status(204).end();
  }),
);

// ---------------------------------------------------------------- users

adminRouter.get(
  '/users',
  validate(
    z.object({
      q: z.string().trim().max(120).optional(),
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(25),
    }),
    'query',
  ),
  asyncHandler(async (req, res) => {
    const { q, page, pageSize } = req.query as unknown as {
      q?: string;
      page: number;
      pageSize: number;
    };
    const search = q ? `%${q.toLowerCase()}%` : null;

    const rows = await queryRows<{
      id: string;
      name: string;
      email: string;
      blocked_at: Date | null;
      tests: number;
      best: number | null;
      percentile: number | null;
    }>(
      `SELECT u.id, u.name, u.email, u.blocked_at,
              count(a.id) FILTER (WHERE a.status = 'submitted')::int AS tests,
              max(a.score) AS best,
              avg(a.percentile) AS percentile
         FROM users u LEFT JOIN attempts a ON a.user_id = u.id
        WHERE u.role = 'student'
          AND ($1::text IS NULL OR lower(u.name || ' ' || u.email) LIKE $1)
        GROUP BY u.id
        ORDER BY tests DESC, u.name ASC
        LIMIT $2 OFFSET $3`,
      [search, pageSize, (page - 1) * pageSize],
    );

    const items: AdminUserRow[] = rows.map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      initials: initialsOf(r.name),
      tests: r.tests,
      best: Number(r.best ?? 0),
      percentile: Number(r.percentile ?? 0).toFixed(2),
      blocked: r.blocked_at !== null,
    }));

    res.json({ items, page, pageSize });
  }),
);

const createUserSchema = z.object({
  name: z.string().trim().min(3, 'Name must be at least 3 characters').max(120),
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  password: z.string().min(8, 'Use at least 8 characters').max(200),
  role: z.enum(['student', 'admin']).default('student'),
});

adminRouter.post(
  '/users',
  validate(createUserSchema),
  asyncHandler(async (req, res) => {
    const { id: adminId } = currentUser(req);
    const body = req.body as z.infer<typeof createUserSchema>;

    const existing = await queryOne<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [
      body.email,
    ]);
    if (existing) throw conflict('An account with that email already exists.');

    const passwordHash = await hashPassword(body.password);
    const row = await queryOne<{ id: string; name: string; email: string }>(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, email`,
      [body.name, body.email, passwordHash, body.role],
    );
    if (!row) throw badRequest('Could not create the account.');

    await audit(adminId, 'user.create', row.id, { email: row.email, role: body.role });
    res.status(201).json({ message: `Account created for ${row.name}` });
  }),
);

adminRouter.post(
  '/users/:id/block',
  asyncHandler(async (req, res) => {
    const { id: adminId } = currentUser(req);
    if (req.params.id === adminId) throw badRequest('You cannot block your own account.');

    const row = await queryOne<{ id: string; name: string; blocked_at: Date | null }>(
      `UPDATE users
          SET blocked_at = CASE WHEN blocked_at IS NULL THEN now() ELSE NULL END
        WHERE id = $1 AND role = 'student'
        RETURNING id, name, blocked_at`,
      [req.params.id],
    );
    if (!row) throw notFound('User not found.');

    // Blocking ends their sessions immediately rather than at token expiry.
    if (row.blocked_at) await revokeAllForUser(row.id);

    await audit(adminId, row.blocked_at ? 'user.block' : 'user.unblock', row.id);
    res.json({
      blocked: row.blocked_at !== null,
      message: `${row.name} ${row.blocked_at ? 'blocked' : 'unblocked'}`,
    });
  }),
);

adminRouter.post(
  '/users/:id/reset-password',
  asyncHandler(async (req, res) => {
    const { id: adminId } = currentUser(req);
    const row = await queryOne<{ id: string; name: string; email: string }>(
      `SELECT id, name, email FROM users WHERE id = $1`,
      [req.params.id],
    );
    if (!row) throw notFound('User not found.');

    // Issues a temporary password and ends existing sessions. Mail delivery is the
    // worker's job; the temporary value is returned so an admin can relay it.
    const temporary = `MM-${Math.random().toString(36).slice(2, 10)}`;
    await query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [
      row.id,
      await hashPassword(temporary),
    ]);
    await revokeAllForUser(row.id);
    await audit(adminId, 'user.reset_password', row.id);

    res.json({ message: `Reset link sent to ${row.email}`, temporaryPassword: temporary });
  }),
);

adminRouter.delete(
  '/users/:id',
  asyncHandler(async (req, res) => {
    const { id: adminId } = currentUser(req);
    if (req.params.id === adminId) throw badRequest('You cannot delete your own account.');

    const row = await queryOne<{ name: string }>(
      `DELETE FROM users WHERE id = $1 AND role = 'student' RETURNING name`,
      [req.params.id],
    );
    if (!row) throw notFound('User not found.');
    await audit(adminId, 'user.delete', req.params.id ?? null, { name: row.name });
    res.json({ message: `${row.name} deleted` });
  }),
);
