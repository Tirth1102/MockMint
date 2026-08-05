import { Router } from 'express';
import { z } from 'zod';
import {
  SECTIONS,
  fmtShortDate,
  greetingFor,
  type Bookmark,
  type CalendarPayload,
  type DashboardPayload,
  type HeatCell,
  type NotificationItem,
  type SectionKey,
  type StatCard,
  type StrengthBar,
  type ResultSummary,
} from '@mockmint/shared';
import { query, queryOne, queryRows } from '../../db/pool.js';
import { asyncHandler } from '../../middleware/error.js';
import { requireAuth, currentUser } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { guardUuidParams } from '../../middleware/params.js';
import { badRequest, notFound, unauthorized } from '../../lib/errors.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { revokeAllForUser } from '../auth/tokens.js';
import { toUser, USER_COLUMNS, type UserRow } from '../users/mapper.js';

export const meRouter = Router();
meRouter.use(requireAuth);
guardUuidParams(meRouter, 'questionId');

interface HistoryRow {
  id: string;
  paper_id: string;
  title: string;
  year: number;
  slot: number;
  submitted_at: Date;
  score: number;
  percentile: number;
  accuracy: number;
  total_time_sec: number;
  section_scores: number[];
}

async function loadHistory(userId: string): Promise<HistoryRow[]> {
  return queryRows<HistoryRow>(
    `SELECT a.id, a.paper_id, p.title, p.year, p.slot, a.submitted_at, a.score, a.percentile,
            a.accuracy, a.total_time_sec,
            COALESCE((
              SELECT array_agg(sr.score ORDER BY array_position(ARRAY['VARC','DILR','QA']::text[], sr.section_key))
                FROM section_results sr WHERE sr.attempt_id = a.id
            ), ARRAY[]::numeric[]) AS section_scores
       FROM attempts a JOIN papers p ON p.id = a.paper_id
      WHERE a.user_id = $1 AND a.status = 'submitted'
      ORDER BY a.submitted_at ASC`,
    [userId],
  );
}

function toSummary(row: HistoryRow): ResultSummary {
  return {
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
  };
}

/** Builds `days` heat cells ending today, newest last. */
async function loadHeat(userId: string, days: number): Promise<HeatCell[]> {
  const rows = await queryRows<{ day: Date; sets: number }>(
    `SELECT day, sets FROM practice_log
      WHERE user_id = $1 AND day > current_date - $2::int
      ORDER BY day`,
    [userId, days],
  );
  const byDay = new Map(rows.map((r) => [new Date(r.day).toISOString().slice(0, 10), r.sets]));

  const cells: HeatCell[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const key = date.toISOString().slice(0, 10);
    const sets = byDay.get(key) ?? 0;
    const level = sets === 0 ? 0 : sets >= 8 ? 4 : sets >= 6 ? 3 : sets >= 4 ? 2 : 1;
    cells.push({
      level,
      date: key,
      title: sets ? `${sets} sets practised` : 'no practice',
    });
  }
  return cells;
}

// ---------------------------------------------------------------- profile

meRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { id } = currentUser(req);
    const row = await queryOne<UserRow>(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [id]);
    if (!row) throw notFound('Account not found.');

    const history = await loadHistory(id);
    const bookmarkCount = await queryOne<{ n: number }>(
      `SELECT count(*)::int AS n FROM bookmarks WHERE user_id = $1`,
      [id],
    );
    const best = history.reduce((max, h) => Math.max(max, Number(h.score ?? 0)), 0);
    const avgAccuracy = history.length
      ? Math.round(history.reduce((sum, h) => sum + Number(h.accuracy ?? 0), 0) / history.length)
      : 0;

    res.json({
      user: toUser(row),
      stats: {
        tests: history.length,
        best,
        avgAccuracy,
        bookmarks: bookmarkCount?.n ?? 0,
      },
    });
  }),
);

meRouter.patch(
  '/',
  validate(
    z.object({
      name: z.string().trim().min(2).max(120).optional(),
      photoUrl: z.string().url().max(500).nullable().optional(),
      targetPercentile: z.number().min(0).max(100).nullable().optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const { id } = currentUser(req);
    const body = req.body as {
      name?: string;
      photoUrl?: string | null;
      targetPercentile?: number | null;
    };

    const row = await queryOne<UserRow>(
      `UPDATE users SET
         name              = COALESCE($2, name),
         photo_url         = COALESCE($3, photo_url),
         target_percentile = COALESCE($4, target_percentile)
       WHERE id = $1
       RETURNING ${USER_COLUMNS}`,
      [id, body.name ?? null, body.photoUrl ?? null, body.targetPercentile ?? null],
    );
    if (!row) throw notFound('Account not found.');
    res.json({ user: toUser(row) });
  }),
);

meRouter.post(
  '/password',
  validate(
    z.object({
      current: z.string().min(1, 'Enter your current password.'),
      next: z.string().min(8, 'Use at least 8 characters.').max(200),
    }),
  ),
  asyncHandler(async (req, res) => {
    const { id } = currentUser(req);
    const { current, next } = req.body as { current: string; next: string };

    const row = await queryOne<{ password_hash: string }>(
      `SELECT password_hash FROM users WHERE id = $1`,
      [id],
    );
    if (!row) throw notFound('Account not found.');
    if (!(await verifyPassword(row.password_hash, current))) {
      throw unauthorized('Your current password is incorrect.');
    }
    if (current === next) throw badRequest('Choose a password you have not used here before.');

    await query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [id, await hashPassword(next)]);
    // Changing a password signs out every other device.
    await revokeAllForUser(id);

    res.json({ message: 'Password updated.' });
  }),
);

// ---------------------------------------------------------------- dashboard

meRouter.get(
  '/dashboard',
  asyncHandler(async (req, res) => {
    const { id } = currentUser(req);
    const row = await queryOne<UserRow>(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [id]);
    if (!row) throw notFound('Account not found.');

    const history = await loadHistory(id);
    const firstName = row.name.split(' ')[0] ?? row.name;

    if (history.length === 0) {
      const payload: DashboardPayload = {
        greeting: greetingFor(new Date(), firstName),
        line: 'No attempts yet — pick a paper and sit it under real conditions.',
        statCards: [],
        trend: [],
        strength: SECTIONS.map((s) => ({ label: s.key, pct: 0, note: 'no attempts yet' })),
        recent: [],
        coach: {
          headline: 'Start with one full-length paper.',
          body: 'A single timed attempt tells you more about your section balance than a week of untimed practice. Pick any year and sit all three sections.',
        },
        heat: await loadHeat(id, 28),
        streakLine: 'No practice logged yet',
      };
      res.json(payload);
      return;
    }

    const best = history.reduce((max, h) => Math.max(max, Number(h.score ?? 0)), 0);
    const avgAccuracy = Math.round(
      history.reduce((sum, h) => sum + Number(h.accuracy ?? 0), 0) / history.length,
    );
    const totalSeconds = history.reduce((sum, h) => sum + (h.total_time_sec ?? 0), 0);
    const last = history[history.length - 1]!;

    const recentWindow = history.filter(
      (h) => Date.now() - new Date(h.submitted_at).getTime() < 7 * 24 * 60 * 60 * 1000,
    ).length;

    const earlier = history.slice(0, -3);
    const lastThree = history.slice(-3);
    const earlierAcc = earlier.length
      ? earlier.reduce((sum, h) => sum + Number(h.accuracy ?? 0), 0) / earlier.length
      : 0;
    const recentAcc = lastThree.length
      ? lastThree.reduce((sum, h) => sum + Number(h.accuracy ?? 0), 0) / lastThree.length
      : 0;
    const accDelta = Math.round(recentAcc - earlierAcc);

    const statCards: StatCard[] = [
      {
        label: 'Tests attempted',
        value: String(history.length),
        unit: 'papers',
        delta: recentWindow ? `+${recentWindow} this week` : 'none this week',
        deltaTone: recentWindow ? 'ok' : 'muted',
      },
      {
        label: 'Best score',
        value: String(best),
        unit: '/ 198',
        delta: `${Number(last.percentile ?? 0).toFixed(2)} %ile`,
        deltaTone: 'muted',
      },
      {
        label: 'Average accuracy',
        value: String(avgAccuracy),
        unit: '%',
        delta: earlier.length
          ? `${accDelta >= 0 ? '+' : ''}${accDelta} pts vs. earlier`
          : 'first attempts',
        deltaTone: accDelta >= 0 ? 'ok' : 'bad',
      },
      {
        label: 'Time on tests',
        value: (totalSeconds / 3600).toFixed(1),
        unit: 'hours',
        delta: `≈ ${Math.round(totalSeconds / 60 / history.length)} min / paper`,
        deltaTone: 'muted',
      },
    ];

    const sectionAverages = SECTIONS.map((_, i) =>
      Math.round(
        history.reduce((sum, h) => sum + Number(h.section_scores?.[i] ?? 0), 0) / history.length,
      ),
    );
    const strength: StrengthBar[] = SECTIONS.map((section, i) => {
      const max = section.count * 3;
      const avg = sectionAverages[i] ?? 0;
      return {
        label: section.key,
        pct: Math.max(0, Math.round((avg / max) * 100)),
        note: `avg ${avg} of ${max} marks`,
      };
    });

    const practiceDays = await queryOne<{ active: number; streak: number }>(
      // Consecutive-day streak: number the practised days backwards from today; a day
      // belongs to the current run while `day` still equals `today − (rank − 1)`.
      // row_number() is bigint, so the offset needs an explicit ::int for date arithmetic.
      `WITH days AS (
         SELECT day FROM practice_log WHERE user_id = $1 AND sets > 0
       ), ranked AS (
         SELECT day, (row_number() OVER (ORDER BY day DESC))::int AS rn FROM days
       )
       SELECT (SELECT count(*)::int FROM days WHERE day > current_date - 28) AS active,
              (SELECT count(*)::int FROM ranked r
                WHERE r.day = current_date - (r.rn - 1)) AS streak`,
      [id],
    );

    const payload: DashboardPayload = {
      greeting: greetingFor(new Date(), firstName),
      line: `${history.length} tests logged · best ${best} marks · last attempt ${fmtShortDate(last.submitted_at)}`,
      statCards,
      trend: history.slice(-8).map((h) => ({
        label: `S${h.slot}'${String(h.year).slice(2)}`,
        score: Number(h.score ?? 0),
      })),
      strength,
      recent: history.slice().reverse().slice(0, 4).map(toSummary),
      coach:
        avgAccuracy < 65
          ? {
              headline: 'Accuracy first. Attempts later.',
              body: `At ${avgAccuracy}% accuracy, every extra attempt costs you as often as it pays. Take the next paper with a hard rule: no answer unless you are sure within 90 seconds.`,
            }
          : {
              headline: 'Your accuracy holds — now raise the attempt count.',
              body: 'You are converting what you attempt. Push attempts up by five per section and watch whether accuracy holds above 68%.',
            },
      heat: await loadHeat(id, 28),
      streakLine: `${practiceDays?.streak ?? 0}-day streak · ${practiceDays?.active ?? 0} of the last 28 days practised`,
    };

    res.json(payload);
  }),
);

// ---------------------------------------------------------------- calendar

meRouter.get(
  '/practice/calendar',
  validate(z.object({ days: z.coerce.number().int().min(28).max(365).default(182) }), 'query'),
  asyncHandler(async (req, res) => {
    const { id } = currentUser(req);
    const { days } = req.query as unknown as { days: number };
    const heat = await loadHeat(id, days);

    const stats = await queryOne<{
      active: number;
      streak: number;
      longest: number;
      sets: number;
    }>(
      `WITH days AS (
         SELECT day FROM practice_log WHERE user_id = $1 AND sets > 0
       ), ranked AS (
         SELECT day, day - (row_number() OVER (ORDER BY day))::int AS grp FROM days
       ), runs AS (
         SELECT count(*)::int AS len, max(day) AS ends FROM ranked GROUP BY grp
       )
       SELECT (SELECT count(*)::int FROM days WHERE day > current_date - 28)          AS active,
              COALESCE((SELECT len FROM runs WHERE ends >= current_date - 1), 0)      AS streak,
              COALESCE((SELECT max(len) FROM runs), 0)                                AS longest,
              COALESCE((SELECT sum(sets)::int FROM practice_log WHERE user_id = $1), 0) AS sets`,
      [id],
    );

    const payload: CalendarPayload = {
      heat,
      stats: [
        { v: String(stats?.active ?? 0), k: 'Days active (28d)' },
        { v: String(stats?.streak ?? 0), k: 'Current streak' },
        { v: String(stats?.longest ?? 0), k: 'Longest streak' },
        { v: String(stats?.sets ?? 0), k: 'Sets practised' },
      ],
    };
    res.json(payload);
  }),
);

// ---------------------------------------------------------------- bookmarks

meRouter.get(
  '/bookmarks',
  asyncHandler(async (req, res) => {
    const { id } = currentUser(req);
    const rows = await queryRows<{
      question_id: string;
      section_key: SectionKey;
      position: number;
      topic: string;
      stem: string;
      created_at: Date;
    }>(
      `SELECT b.question_id, q.section_key, q.position, q.topic, q.stem, b.created_at
         FROM bookmarks b JOIN questions q ON q.id = b.question_id
        WHERE b.user_id = $1
        ORDER BY b.created_at DESC`,
      [id],
    );

    const items: Bookmark[] = rows.map((r) => ({
      questionId: r.question_id,
      no: r.position,
      sec: r.section_key,
      topic: r.topic,
      text: r.stem,
      createdAt: new Date(r.created_at).toISOString(),
    }));
    res.json({ items });
  }),
);

meRouter.post(
  '/bookmarks/:questionId',
  asyncHandler(async (req, res) => {
    const { id } = currentUser(req);
    const result = await query(
      `INSERT INTO bookmarks (user_id, question_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [id, req.params.questionId],
    );
    res.status(result.rowCount ? 201 : 200).json({ bookmarked: true });
  }),
);

meRouter.delete(
  '/bookmarks/:questionId',
  asyncHandler(async (req, res) => {
    const { id } = currentUser(req);
    await query(`DELETE FROM bookmarks WHERE user_id = $1 AND question_id = $2`, [
      id,
      req.params.questionId,
    ]);
    res.json({ bookmarked: false });
  }),
);

// ---------------------------------------------------------------- notifications

meRouter.get(
  '/notifications',
  asyncHandler(async (req, res) => {
    const { id } = currentUser(req);
    const rows = await queryRows<{
      id: string;
      kind: NotificationItem['kind'];
      body: string;
      read_at: Date | null;
      created_at: Date;
    }>(
      `SELECT id, kind, body, read_at, created_at FROM notifications
        WHERE user_id = $1 OR user_id IS NULL
        ORDER BY created_at DESC LIMIT 20`,
      [id],
    );

    const items: NotificationItem[] = rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      body: r.body,
      when: relativeTime(r.created_at),
      readAt: r.read_at ? new Date(r.read_at).toISOString() : null,
    }));
    res.json({ items, unread: items.filter((i) => !i.readAt).length });
  }),
);

meRouter.post(
  '/notifications/read',
  asyncHandler(async (req, res) => {
    const { id } = currentUser(req);
    await query(
      `UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL`,
      [id],
    );
    res.status(204).end();
  }),
);

function relativeTime(date: Date): string {
  const diff = Date.now() - new Date(date).getTime();
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 1) return 'Just now';
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  return `${days} days ago`;
}
