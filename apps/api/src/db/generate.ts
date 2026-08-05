/**
 * Deterministic question generation for seeded papers.
 *
 * Every paper opens each section with the authored items, then fills the remaining
 * positions with placeholders derived from a `(year, slot, section, index)` seed —
 * so the same paper always produces the same bank, and an admin bulk upload can
 * replace placeholders without disturbing the authored questions.
 */
import type { Difficulty, QuestionType, SectionKey } from '@mockmint/shared';
import { SECTIONS } from '@mockmint/shared';
import { AUTHORED, DIFFICULTY_POOL, TOPICS } from './content.js';

export interface GeneratedQuestion {
  code: string;
  sectionKey: SectionKey;
  /** 1-based position within the section. */
  position: number;
  /** 1-based index across the whole paper. */
  no: number;
  type: QuestionType;
  topic: string;
  difficulty: Difficulty;
  passage: string | null;
  passageLabel: string | null;
  stem: string;
  options: string[];
  correctOption: number | null;
  titaAnswer: string | null;
  explanation: string;
  marks: number;
  negativeMarks: number;
  isPlaceholder: boolean;
}

export function buildPaperQuestions(year: number, slot: number): GeneratedQuestion[] {
  const out: GeneratedQuestion[] = [];
  let no = 0;

  SECTIONS.forEach((section, si) => {
    const authored = AUTHORED[section.key];

    for (let i = 0; i < section.count; i++) {
      no += 1;
      const code = `${year}-${slot}-${1000 + no}`;
      const a = authored[i];

      if (a) {
        const isMcq = a.type === 'MCQ';
        out.push({
          code,
          sectionKey: section.key,
          position: i + 1,
          no,
          type: a.type,
          topic: a.topic,
          difficulty: a.diff,
          passage: a.passage ?? null,
          passageLabel: a.passageLabel ?? null,
          stem: a.q,
          options: a.opts,
          correctOption: isMcq ? Number(a.ans) : null,
          titaAnswer: isMcq ? null : String(a.ans),
          explanation: a.expl,
          marks: 3,
          negativeMarks: isMcq ? 1 : 0,
          isPlaceholder: false,
        });
        continue;
      }

      const seed = (year * 7 + slot * 13 + si * 17 + i * 29) % 1000;
      const isTita = seed % 5 === 0;
      const topic = TOPICS[section.key][seed % 6] ?? section.key;
      const difficulty = DIFFICULTY_POOL[seed % 3] ?? 'Medium';

      out.push({
        code,
        sectionKey: section.key,
        position: i + 1,
        no,
        type: isTita ? 'TITA' : 'MCQ',
        topic,
        difficulty,
        passage: null,
        passageLabel: null,
        stem:
          `[${section.key} Q${i + 1} · ${topic}] Placeholder question — import your question bank ` +
          `to replace this stem. All timing, marking and analytics are computed from real responses.`,
        options: isTita
          ? []
          : [`Option A for Q${no}`, `Option B for Q${no}`, `Option C for Q${no}`, `Option D for Q${no}`],
        correctOption: isTita ? null : seed % 4,
        titaAnswer: isTita ? String(10 + (seed % 90)) : null,
        explanation:
          `Placeholder explanation for ${section.key} Q${i + 1}. Bulk-upload your bank ` +
          `(XLSX/CSV/JSON) from the admin panel and explanations appear here.`,
        marks: 3,
        negativeMarks: isTita ? 0 : 1,
        isPlaceholder: true,
      });
    }
  });

  return out;
}
