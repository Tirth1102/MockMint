/**
 * Seeds a fresh database with:
 *   · demo admin + student accounts
 *   · CAT papers 2015–2025 (two slots per year before 2020, three from 2020)
 *   · a full question bank per paper (authored items + deterministic placeholders)
 *   · five historical attempts for the demo student, graded from real responses so
 *     the dashboard, results list and leaderboard are computed, not hard-coded
 *   · notifications and a practice log for the calendar heatmap
 *
 *   npm run db:seed
 */
import { hash as argonHash } from '@node-rs/argon2';
import {
  SECTIONS,
  estimatePercentileForPaper,
  grade,
  initialsOf,
  type SectionKey,
} from '@mockmint/shared';
import { config } from '../config.js';
import { closePool, transaction } from './pool.js';
import { seededPapers } from './content.js';
import { buildPaperQuestions, type GeneratedQuestion } from './generate.js';
import { ARGON_OPTIONS } from '../modules/auth/password.js';

/** Historical attempts to synthesise for the demo student. */
const HISTORY: { year: number; slot: number; daysAgo: number; targetAccuracy: number }[] = [
  { year: 2021, slot: 1, daysAgo: 54, targetAccuracy: 61 },
  { year: 2022, slot: 2, daysAgo: 40, targetAccuracy: 57 },
  { year: 2022, slot: 1, daysAgo: 27, targetAccuracy: 66 },
  { year: 2023, slot: 3, daysAgo: 15, targetAccuracy: 63 },
  { year: 2023, slot: 1, daysAgo: 1, targetAccuracy: 70 },
];

const BROADCAST_NOTIFICATIONS: { kind: string; body: string; daysAgo: number }[] = [
  { kind: 'accent', body: 'CAT 2025 Slot 3 paper is now live with full explanations.', daysAgo: 0 },
  { kind: 'ok', body: 'Your DILR accuracy crossed 60% for the first time.', daysAgo: 1 },
  { kind: 'info', body: 'Weekly report ready — 4 tests, +14 marks vs. last week.', daysAgo: 2 },
  { kind: 'warn', body: 'Unfinished attempt on CAT 2024 Slot 1 expires in 3 days.', daysAgo: 4 },
];

async function main(): Promise<void> {
  await transaction(async (client) => {
    console.log('· clearing existing seed data');
    await client.query(`
      TRUNCATE responses, section_results, attempts, bookmarks, practice_log,
               notifications, upload_jobs, admin_audit_log, questions, passages,
               paper_sections, papers, refresh_tokens, users
      RESTART IDENTITY CASCADE
    `);

    // ------------------------------------------------------------ users
    console.log('· creating demo accounts');
    const adminHash = await argonHash(config.seed.adminPassword, ARGON_OPTIONS);
    const studentHash = await argonHash(config.seed.studentPassword, ARGON_OPTIONS);

    const { rows: adminRows } = await client.query<{ id: string }>(
      `INSERT INTO users (name, email, password_hash, role, email_verified_at)
       VALUES ($1, $2, $3, 'admin', now()) RETURNING id`,
      ['MockMint Admin', config.seed.adminEmail, adminHash],
    );
    const adminId = adminRows[0]!.id;

    const { rows: studentRows } = await client.query<{ id: string }>(
      `INSERT INTO users (name, email, password_hash, role, email_verified_at, target_percentile)
       VALUES ($1, $2, $3, 'student', now(), 99.2) RETURNING id`,
      ['Aarav Sharma', config.seed.studentEmail, studentHash],
    );
    const studentId = studentRows[0]!.id;

    // A small cohort so the leaderboard and admin user table have real rows.
    const cohort: { name: string; email: string; attempts: number }[] = [
      { name: 'Rhea Kapoor', email: 'rhea.k@email.com', attempts: 22 },
      { name: 'Ishaan Rao', email: 'ishaan@email.com', attempts: 19 },
      { name: 'Meera Iyer', email: 'meera.iyer@email.com', attempts: 17 },
      { name: 'Kabir Shah', email: 'kabir.shah@email.com', attempts: 11 },
      { name: 'Tanvi Desai', email: 'tanvi@email.com', attempts: 9 },
      { name: 'Nikhil Bose', email: 'nikhil.b@email.com', attempts: 7 },
      { name: 'Sara Ali', email: 'sara.ali@email.com', attempts: 5 },
      { name: 'Dev Menon', email: 'dev.menon@email.com', attempts: 3 },
    ];
    const cohortHash = await argonHash('demo1234', ARGON_OPTIONS);
    const cohortIds = new Map<string, string>();
    for (const member of cohort) {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO users (name, email, password_hash, role, email_verified_at)
         VALUES ($1, $2, $3, 'student', now()) RETURNING id`,
        [member.name, member.email, cohortHash],
      );
      cohortIds.set(member.email, rows[0]!.id);
    }

    // ------------------------------------------------------------ papers
    const papers = seededPapers();
    console.log(`· seeding ${papers.length} papers with question banks`);

    /** paperKey "2023-1" → { paperId, questions with db ids } */
    const paperIndex = new Map<
      string,
      { paperId: string; questions: (GeneratedQuestion & { id: string })[] }
    >();

    for (const paper of papers) {
      const title = `CAT ${paper.year} — Slot ${paper.slot}`;
      const { rows: paperRows } = await client.query<{ id: string }>(
        `INSERT INTO papers (year, slot, title, duration_min, total_marks, difficulty,
                             status, published_at, created_by)
         VALUES ($1, $2, $3, 120, 198, $4, 'live', now(), $5) RETURNING id`,
        [paper.year, paper.slot, title, paper.difficulty, adminId],
      );
      const paperId = paperRows[0]!.id;

      for (const [position, section] of SECTIONS.entries()) {
        await client.query(
          `INSERT INTO paper_sections (paper_id, key, position, question_count, duration_min)
           VALUES ($1, $2, $3, $4, $5)`,
          [paperId, section.key, position, section.count, section.mins],
        );
      }

      const generated = buildPaperQuestions(paper.year, paper.slot);

      // Questions that share passage text share one passage row, so an RC set stays a set.
      const passageIds = new Map<string, string>();
      for (const q of generated) {
        if (!q.passage || passageIds.has(q.passage)) continue;
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO passages (paper_id, section_key, body, label)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [paperId, q.sectionKey, q.passage, q.passageLabel],
        );
        passageIds.set(q.passage, rows[0]!.id);
      }

      const stored: (GeneratedQuestion & { id: string })[] = [];
      for (const q of generated) {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO questions (paper_id, code, section_key, position, passage_id, type, stem,
                                  options, correct_option, tita_answer, explanation, difficulty,
                                  topic, marks, negative_marks)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
          [
            paperId,
            q.code,
            q.sectionKey,
            q.position,
            q.passage ? passageIds.get(q.passage) : null,
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
        stored.push({ ...q, id: rows[0]!.id });
      }

      paperIndex.set(`${paper.year}-${paper.slot}`, { paperId, questions: stored });
    }

    // ------------------------------------------------------------ history
    console.log('· synthesising graded attempt history');
    for (const entry of HISTORY) {
      const key = `${entry.year}-${entry.slot}`;
      const paper = paperIndex.get(key);
      if (!paper) continue;
      await seedAttempt(client, {
        userId: studentId,
        paperId: paper.paperId,
        questions: paper.questions,
        daysAgo: entry.daysAgo,
        targetAccuracy: entry.targetAccuracy,
      });
    }

    // Give the cohort one graded attempt each so the leaderboard is real.
    const cohortPaper = paperIndex.get('2024-1');
    if (cohortPaper) {
      for (const [i, member] of cohort.entries()) {
        const id = cohortIds.get(member.email);
        if (!id) continue;
        await seedAttempt(client, {
          userId: id,
          paperId: cohortPaper.paperId,
          questions: cohortPaper.questions,
          daysAgo: 3 + i,
          targetAccuracy: 84 - i * 5,
        });
      }
    }

    // ------------------------------------------------------------ engagement
    console.log('· seeding notifications, practice log and bookmarks');
    for (const n of BROADCAST_NOTIFICATIONS) {
      await client.query(
        `INSERT INTO notifications (user_id, kind, body, created_at)
         VALUES ($1, $2, $3, now() - ($4 || ' days')::interval)`,
        [studentId, n.kind, n.body, n.daysAgo],
      );
    }

    // 182 days of practice history, dense enough to render a believable heatmap.
    for (let i = 0; i < 182; i++) {
      const s = (i * 37 + 5) % 11;
      const level = s > 8 ? 4 : s > 6 ? 3 : s > 4 ? 2 : s > 2 ? 1 : 0;
      if (level === 0) continue;
      await client.query(
        `INSERT INTO practice_log (user_id, day, sets)
         VALUES ($1, (current_date - $2::int), $3)
         ON CONFLICT (user_id, day) DO UPDATE SET sets = EXCLUDED.sets`,
        [studentId, i, level * 2],
      );
    }

    // Two starting bookmarks so the Bookmarks page is not empty on first login.
    const bookmarkSource = paperIndex.get('2023-1');
    if (bookmarkSource) {
      const hardOnes = bookmarkSource.questions.filter((q) => !q.isPlaceholder).slice(0, 2);
      for (const q of hardOnes) {
        await client.query(
          `INSERT INTO bookmarks (user_id, question_id) VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [studentId, q.id],
        );
      }
    }
  });

  console.log('\n✓ seed complete');
  console.log(`  admin    ${config.seed.adminEmail} · ${config.seed.adminPassword}`);
  console.log(`  student  ${config.seed.studentEmail} · ${config.seed.studentPassword}`);
}

/**
 * Creates one submitted attempt with deterministic responses, then grades it with the
 * same shared `grade()` the live exam engine uses — so seeded history and real history
 * are scored identically.
 */
async function seedAttempt(
  client: { query: (text: string, params?: unknown[]) => Promise<{ rows: { id: string }[] }> },
  opts: {
    userId: string;
    paperId: string;
    questions: (GeneratedQuestion & { id: string })[];
    daysAgo: number;
    targetAccuracy: number;
  },
): Promise<void> {
  const { userId, paperId, questions, daysAgo, targetAccuracy } = opts;

  const perSection = new Map<
    SectionKey,
    { attempted: number; correct: number; wrong: number; score: number; max: number; time: number }
  >();
  for (const section of SECTIONS) {
    perSection.set(section.key, {
      attempted: 0,
      correct: 0,
      wrong: 0,
      score: 0,
      max: 0,
      time: 0,
    });
  }

  const rows: {
    questionId: string;
    answer: { option: number } | { text: string } | null;
    isCorrect: boolean | null;
    marks: number | null;
    time: number;
  }[] = [];

  questions.forEach((q, i) => {
    const bucket = perSection.get(q.sectionKey)!;
    bucket.max += q.marks;

    const seed = (targetAccuracy * 7 + i * 31) % 100;
    const timeSpent = 40 + ((seed * 13) % 140);
    bucket.time += timeSpent;

    // Roughly 22% of questions are left untouched, matching the prototype's profile.
    if (seed < 22) {
      rows.push({ questionId: q.id, answer: null, isCorrect: null, marks: null, time: timeSpent });
      return;
    }

    const shouldBeRight = seed < 22 + Math.round(targetAccuracy * 0.78);
    let answer: { option: number } | { text: string };
    if (q.type === 'TITA') {
      const correct = q.titaAnswer ?? '0';
      answer = { text: shouldBeRight ? correct : String(Number(correct) + 3) };
    } else {
      const correct = q.correctOption ?? 0;
      answer = { option: shouldBeRight ? correct : (correct + 1) % 4 };
    }

    const result = grade(
      {
        type: q.type,
        correctOption: q.correctOption,
        titaAnswer: q.titaAnswer,
        marks: q.marks,
        negativeMarks: q.negativeMarks,
      },
      answer,
    );

    bucket.attempted += 1;
    if (result.isCorrect) bucket.correct += 1;
    else bucket.wrong += 1;
    bucket.score += result.marksAwarded;

    rows.push({
      questionId: q.id,
      answer,
      isCorrect: result.isCorrect,
      marks: result.marksAwarded,
      time: timeSpent,
    });
  });

  const totals = [...perSection.values()].reduce(
    (acc, s) => ({
      attempted: acc.attempted + s.attempted,
      correct: acc.correct + s.correct,
      wrong: acc.wrong + s.wrong,
      score: acc.score + s.score,
      max: acc.max + s.max,
      time: acc.time + s.time,
    }),
    { attempted: 0, correct: 0, wrong: 0, score: 0, max: 0, time: 0 },
  );

  const accuracy = totals.attempted ? Math.round((totals.correct / totals.attempted) * 100) : 0;
  const percentile = estimatePercentileForPaper(totals.score, totals.max);

  const { rows: attemptRows } = await client.query(
    `INSERT INTO attempts (user_id, paper_id, status, current_section, section_deadline_at,
                           started_at, submitted_at, auto_submitted, score, correct, wrong,
                           attempted, accuracy, percentile, total_time_sec)
     VALUES ($1, $2, 'submitted', 2,
             ARRAY[now(), now(), now()]::timestamptz[],
             now() - ($3 || ' days')::interval,
             now() - ($3 || ' days')::interval + interval '120 minutes',
             false, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id`,
    [
      userId,
      paperId,
      daysAgo,
      totals.score,
      totals.correct,
      totals.wrong,
      totals.attempted,
      accuracy,
      percentile,
      totals.time,
    ],
  );
  const attemptId = attemptRows[0]!.id;

  for (const r of rows) {
    await client.query(
      `INSERT INTO responses (attempt_id, question_id, answer, marked_for_review, visited,
                              time_spent_sec, is_correct, marks_awarded)
       VALUES ($1, $2, $3::jsonb, false, true, $4, $5, $6)`,
      [
        attemptId,
        r.questionId,
        r.answer ? JSON.stringify(r.answer) : null,
        r.time,
        r.isCorrect,
        r.marks,
      ],
    );
  }

  for (const section of SECTIONS) {
    const s = perSection.get(section.key)!;
    const count = questions.filter((q) => q.sectionKey === section.key).length;
    await client.query(
      `INSERT INTO section_results (attempt_id, section_key, attempted, correct, wrong, skipped,
                                    accuracy, score, max_marks, time_sec)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        attemptId,
        section.key,
        s.attempted,
        s.correct,
        s.wrong,
        count - s.attempted,
        s.attempted ? Math.round((s.correct / s.attempted) * 100) : 0,
        s.score,
        s.max,
        s.time,
      ],
    );
  }
}

main()
  .then(closePool)
  .catch(async (err) => {
    console.error(err);
    await closePool();
    process.exit(1);
  });
