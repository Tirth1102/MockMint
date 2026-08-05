/**
 * Section layout for a standard CAT paper.
 *
 * Order is significant: sections unlock strictly in array order (VARC → DILR → QA)
 * and each carries its own independent timer. Mirrors the prototype's `SECS`.
 */

export const SECTION_KEYS = ['VARC', 'DILR', 'QA'] as const;

export type SectionKey = (typeof SECTION_KEYS)[number];

export interface SectionConfig {
  key: SectionKey;
  /** Long-form name shown in the exam sidebar and result table. */
  name: string;
  /** Number of questions the section carries in a standard paper. */
  count: number;
  /** Sectional lock, in minutes. */
  mins: number;
}

export const SECTIONS: readonly SectionConfig[] = [
  { key: 'VARC', name: 'Verbal Ability & RC', count: 24, mins: 40 },
  { key: 'DILR', name: 'Data Interpretation & LR', count: 20, mins: 40 },
  { key: 'QA', name: 'Quantitative Ability', count: 22, mins: 40 },
] as const;

/** Total questions in a standard paper — 66. */
export const STANDARD_QUESTION_COUNT = SECTIONS.reduce((sum, s) => sum + s.count, 0);

/** Total marks in a standard paper at +3 per question — 198. */
export const STANDARD_TOTAL_MARKS = STANDARD_QUESTION_COUNT * 3;

/** Default full-paper duration in minutes — 120. */
export const STANDARD_DURATION_MIN = SECTIONS.reduce((sum, s) => sum + s.mins, 0);

export function sectionIndex(key: SectionKey): number {
  return SECTIONS.findIndex((s) => s.key === key);
}

export function sectionConfig(key: SectionKey): SectionConfig {
  const found = SECTIONS.find((s) => s.key === key);
  if (!found) throw new Error(`Unknown section key: ${key}`);
  return found;
}

export function isSectionKey(value: unknown): value is SectionKey {
  return typeof value === 'string' && (SECTION_KEYS as readonly string[]).includes(value);
}
