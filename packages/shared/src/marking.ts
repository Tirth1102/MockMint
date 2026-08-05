import type { QuestionType } from './types.js';

/**
 * Marking rules (ARCHITECTURE.md §3).
 *
 *   | Type | Correct | Incorrect | Unattempted |
 *   | MCQ  |  +3     |  −1       |  0          |
 *   | TITA |  +3     |   0       |  0          |
 *
 * `negativeMarks` is stored as a positive magnitude and subtracted.
 */
export const DEFAULT_MARKS = 3;
export const DEFAULT_NEGATIVE_MARKS = 1;

/** TITA never carries a penalty, whatever the row in the question bank says. */
export function negativeMarksFor(type: QuestionType, stored: number | null | undefined): number {
  if (type === 'TITA') return 0;
  return stored ?? DEFAULT_NEGATIVE_MARKS;
}

export type StoredAnswer = { option: number } | { text: string } | null;

/** True when the response holds an actual answer (a cleared response is not an attempt). */
export function isAttempted(answer: StoredAnswer): boolean {
  if (answer === null || answer === undefined) return false;
  if ('option' in answer) return Number.isInteger(answer.option) && answer.option >= 0;
  return answer.text.trim() !== '';
}

export interface GradableQuestion {
  type: QuestionType;
  correctOption: number | null;
  titaAnswer: string | null;
  marks: number;
  negativeMarks: number;
}

export interface Grade {
  attempted: boolean;
  isCorrect: boolean;
  marksAwarded: number;
}

/**
 * Grades one response. TITA comparison is a trimmed, case-insensitive exact match —
 * numeric answers are additionally compared by value so "23", "23.0" and " 23 " agree.
 */
export function grade(question: GradableQuestion, answer: StoredAnswer): Grade {
  if (!isAttempted(answer)) {
    return { attempted: false, isCorrect: false, marksAwarded: 0 };
  }

  let isCorrect = false;

  if (question.type === 'MCQ') {
    isCorrect = answer !== null && 'option' in answer && answer.option === question.correctOption;
  } else {
    const given = answer !== null && 'text' in answer ? answer.text.trim() : '';
    const expected = (question.titaAnswer ?? '').trim();
    if (expected !== '') {
      const givenNum = Number(given);
      const expectedNum = Number(expected);
      isCorrect =
        Number.isFinite(givenNum) && Number.isFinite(expectedNum) && given !== '' && expected !== ''
          ? givenNum === expectedNum
          : given.toLowerCase() === expected.toLowerCase();
    }
  }

  const penalty = negativeMarksFor(question.type, question.negativeMarks);
  return {
    attempted: true,
    isCorrect,
    marksAwarded: isCorrect ? question.marks : -penalty,
  };
}

/** Formats a marks delta the way the review card shows it: "+3", "−1", "0". */
export function formatMarks(marksAwarded: number, attempted: boolean): string {
  if (!attempted) return '0';
  if (marksAwarded > 0) return `+${marksAwarded}`;
  if (marksAwarded < 0) return `−${Math.abs(marksAwarded)}`;
  return '0';
}
