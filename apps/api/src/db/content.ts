/**
 * Authored seed content, ported verbatim from the MockMint prototype.
 *
 * These 15 items are real CAT-style questions with worked explanations. Every paper
 * seeded by `seed.ts` opens each section with these, then fills the remaining slots
 * with generated placeholders that still carry genuine section / topic / difficulty /
 * marking metadata — so analytics are computed from real responses even before a
 * customer imports their own bank (ARCHITECTURE.md §7).
 */
import type { Difficulty, QuestionType, SectionKey } from '@mockmint/shared';

export interface AuthoredQuestion {
  type: QuestionType;
  topic: string;
  diff: Difficulty;
  /** Shared passage body — questions with identical text are grouped into one passage row. */
  passage?: string;
  passageLabel?: string;
  q: string;
  opts: string[];
  /** Option index for MCQ, exact-match string for TITA. */
  ans: number | string;
  expl: string;
}

export const RC_PASSAGE = `Cities were once read as machines: inputs of labour and coal, outputs of goods and smoke. The metaphor was flattering to planners, because machines can be tuned. A neighbourhood that failed was a badly calibrated part, and the remedy was replacement — clear the block, widen the road, rehouse the residents in towers set in lawns.

What this reading missed is that a city is less a machine than a metabolism. Its most valuable structures are not the buildings but the relationships that accumulate around them: the shopkeeper who extends credit, the tenant who watches the street, the informal repair economy that keeps a scooter running for twenty years. These are slow to build and impossible to specify in a drawing. When a block is cleared, the buildings are replaced within a year; the relationships are not replaced at all.

The consequence is a peculiar asymmetry in urban policy. Interventions that destroy relational capital are cheap to execute and their costs appear nowhere in the ledger, while interventions that grow it are expensive, slow, and politically unrewarding. Planners are therefore structurally biased toward demolition — not from malice, but because the accounting system they inherited can only see the machine.`;

const ENROLMENT_TABLE = `Four coaching centres — P, Q, R and S — each enrolled students in three streams (Verbal, Logic, Quant) in 2024. The table gives enrolment in hundreds.

        Verbal   Logic   Quant
P         12       8       20
Q         15      12       13
R          9      18       23
S         14      10       16`;

const ENROLMENT_TABLE_WITH_FEES = `${ENROLMENT_TABLE}

Fee per student per stream: Verbal 8,000; Logic 10,000; Quant 12,000.`;

const SEATING_PUZZLE = `Five friends — Anil, Bina, Chetan, Divya and Esha — sit in a row of five chairs numbered 1 to 5 from left to right.
· Bina sits immediately to the right of Anil.
· Chetan is not at either end.
· Divya sits in chair 5.
· Esha sits somewhere to the left of Chetan.`;

export const AUTHORED: Record<SectionKey, AuthoredQuestion[]> = {
  VARC: [
    {
      type: 'MCQ',
      topic: 'RC · Inference',
      diff: 'Medium',
      passage: RC_PASSAGE,
      passageLabel: 'Read the passage',
      q: 'Which of the following best captures the "peculiar asymmetry in urban policy" the author describes?',
      opts: [
        'Demolition is cheaper than construction, so planners prefer it on budgetary grounds alone.',
        'The harms of destroying relational capital are invisible in official accounting, while building it is costly and slow.',
        'Planners are hostile to informal economies and deliberately displace them.',
        'Relationships in a neighbourhood matter more to residents than buildings do.',
      ],
      ans: 1,
      expl: 'The asymmetry is explicitly about accounting: destructive interventions are "cheap to execute and their costs appear nowhere in the ledger", while constructive ones are "expensive, slow, and politically unrewarding". Option A captures only half; C imports malice the author explicitly rejects; D is true in the passage but is not the asymmetry.',
    },
    {
      type: 'MCQ',
      topic: 'RC · Main idea',
      diff: 'Easy',
      passage: RC_PASSAGE,
      passageLabel: 'Read the passage',
      q: 'The primary purpose of the passage is to:',
      opts: [
        'argue that tower-block housing has failed in most cities.',
        'propose a new accounting standard for municipal budgets.',
        'show how an inherited metaphor distorts what urban policy can perceive.',
        'trace the history of industrial cities and their decline.',
      ],
      ans: 2,
      expl: 'The passage moves from the machine metaphor, to the metabolism alternative, to the conclusion that "the accounting system they inherited can only see the machine". The distortion caused by the metaphor is the thread; the other options are local details or inventions.',
    },
    {
      type: 'MCQ',
      topic: 'RC · Vocabulary in context',
      diff: 'Medium',
      passage: RC_PASSAGE,
      passageLabel: 'Read the passage',
      q: '"Flattering to planners" in the first paragraph implies that the machine metaphor:',
      opts: [
        'overstated the aesthetic quality of industrial cities.',
        'granted planners a sense of competence and control they may not have had.',
        'was invented by planners to justify their salaries.',
        'praised planners in official government reports.',
      ],
      ans: 1,
      expl: 'The clause that follows is the clue: "because machines can be tuned". The metaphor flatters by implying the planner is a competent mechanic with a tunable object — a sense of control the rest of the passage undercuts.',
    },
    {
      type: 'MCQ',
      topic: 'Para summary',
      diff: 'Hard',
      q: 'The four sentences below, when arranged, form a coherent paragraph. Choose the correct order.\n\n1. Standardised tests reward speed of retrieval over depth of understanding.\n2. Yet retrieval speed is itself a proxy for hours of prior practice, which correlates with family resources.\n3. Defenders argue that timing is neutral: everyone faces the same clock.\n4. The clock is neutral only if the preparation behind it was.',
      opts: ['1-3-2-4', '3-1-2-4', '1-2-3-4', '3-4-1-2'],
      ans: 0,
      expl: 'Sentence 1 states the claim, 3 introduces the counter-argument ("Defenders argue"), 2 rebuts it ("Yet"), and 4 closes with the epigram that resolves the rebuttal. 1-3-2-4.',
    },
    {
      type: 'MCQ',
      topic: 'Odd one out',
      diff: 'Medium',
      q: 'Four of the five sentences below form a coherent paragraph. Pick the one that does not belong.',
      opts: [
        'Fermentation was, for most of history, a form of storage rather than a cuisine.',
        'A jar of pickles was insurance against a bad month, not a flourish on a plate.',
        'Modern kitchens fermented for flavour only once refrigeration had made preservation unnecessary.',
        'Refrigerated shipping lowered the price of fresh produce in inland cities by nearly half.',
        'The techniques survived the loss of their purpose, and were reinterpreted as taste.',
      ],
      ans: 3,
      expl: 'The paragraph traces fermentation from preservation to flavour. Option D is a fact about produce pricing and refrigerated logistics — related to refrigeration but not to the fermentation argument.',
    },
  ],

  DILR: [
    {
      type: 'MCQ',
      topic: 'Table analysis',
      diff: 'Medium',
      passage: ENROLMENT_TABLE_WITH_FEES,
      passageLabel: 'Study the data',
      q: 'Which centre earned the highest total fee revenue in 2024?',
      opts: ['P', 'Q', 'R', 'S'],
      ans: 2,
      expl: 'Revenue in ₹ lakh (enrolment in hundreds × fee ÷ 100): P = 12·8 + 8·10 + 20·12 = 96+80+240 = 416. Q = 120+120+156 = 396. R = 72+180+276 = 528. S = 112+100+192 = 404. R is highest.',
    },
    {
      type: 'TITA',
      topic: 'Table analysis',
      diff: 'Hard',
      passage: ENROLMENT_TABLE,
      passageLabel: 'Study the data',
      q: 'What percentage of all Quant enrolments across the four centres came from centre R? (Answer to the nearest integer.)',
      opts: [],
      ans: '32',
      expl: 'Total Quant = 20+13+23+16 = 72 (hundreds). R contributes 23. 23/72 = 31.94%, which rounds to 32.',
    },
    {
      type: 'MCQ',
      topic: 'Arrangement',
      diff: 'Hard',
      passage: SEATING_PUZZLE,
      passageLabel: 'Study the data',
      q: 'Who sits in chair 1?',
      opts: ['Anil', 'Bina', 'Chetan', 'Esha'],
      ans: 3,
      expl: 'Divya is in 5. Chetan must be in 2, 3 or 4. Anil–Bina is a consecutive pair. If Esha is left of Chetan and the pair must fit, the only consistent arrangement is Esha-1, Chetan-2, Anil-3, Bina-4, Divya-5. So Esha sits in chair 1.',
    },
    {
      type: 'MCQ',
      topic: 'Logical reasoning',
      diff: 'Easy',
      q: 'In a group of 100 students, 62 study Statistics, 48 study Economics and 14 study neither. How many study both?',
      opts: ['24', '20', '28', '34'],
      ans: 0,
      expl: 'Students studying at least one = 100 − 14 = 86. |A ∪ B| = |A| + |B| − |A ∩ B| → 86 = 62 + 48 − both → both = 24.',
    },
  ],

  QA: [
    {
      type: 'MCQ',
      topic: 'Arithmetic · Time & work',
      diff: 'Medium',
      q: 'A can finish a job in 12 days and B in 18 days. They work together for 4 days, after which A leaves. In how many more days will B finish the remaining work?',
      opts: ['8', '10', '9', '12'],
      ans: 0,
      expl: 'Combined one-day work = 1/12 + 1/18 = 5/36. In 4 days they complete 20/36 = 5/9, leaving 4/9. B alone does 1/18 per day, so the remaining time = (4/9) × 18 = 8 days.',
    },
    {
      type: 'TITA',
      topic: 'Algebra · Quadratics',
      diff: 'Medium',
      q: 'If x + 1/x = 5, find the value of x² + 1/x².',
      opts: [],
      ans: '23',
      expl: 'Squaring both sides: x² + 2 + 1/x² = 25, so x² + 1/x² = 23.',
    },
    {
      type: 'MCQ',
      topic: 'Geometry · Circles',
      diff: 'Hard',
      q: 'A chord of length 16 cm is at a distance of 6 cm from the centre of a circle. What is the area of the circle, in cm²?',
      opts: ['100π', '64π', '144π', '36π'],
      ans: 0,
      expl: 'Half the chord (8), the distance (6) and the radius form a right triangle: r² = 8² + 6² = 100, so r = 10 and area = 100π.',
    },
    {
      type: 'MCQ',
      topic: 'Arithmetic · Percentages',
      diff: 'Easy',
      q: 'The price of a book is increased by 25% and then reduced by 20%. The net change in price is:',
      opts: ['5% increase', 'no change', '5% decrease', '1% increase'],
      ans: 1,
      expl: '1.25 × 0.80 = 1.00 — the price returns to its original value, so there is no net change.',
    },
    {
      type: 'TITA',
      topic: 'Number theory',
      diff: 'Hard',
      q: 'How many three-digit numbers leave a remainder of 2 when divided by 7?',
      opts: [],
      ans: '129',
      expl: 'The smallest such three-digit number is 100 (100 = 7·14 + 2) and the largest is 996 (996 = 7·142 + 2). Count = 142 − 14 + 1 = 129.',
    },
  ],
};

/** Topic pools used to tag generated placeholder questions. */
export const TOPICS: Record<SectionKey, string[]> = {
  VARC: [
    'RC · Inference',
    'RC · Main idea',
    'Para jumbles',
    'Para summary',
    'Odd one out',
    'RC · Tone',
  ],
  DILR: [
    'Table analysis',
    'Bar graph',
    'Arrangement',
    'Games & tournaments',
    'Venn diagrams',
    'Logical reasoning',
  ],
  QA: [
    'Arithmetic · SI & CI',
    'Algebra · Equations',
    'Geometry · Triangles',
    'Number theory',
    'Arithmetic · Ratios',
    'Modern maths · P&C',
  ],
};

export const DIFFICULTY_POOL: Difficulty[] = ['Easy', 'Medium', 'Hard'];

/** Paper difficulty labels, chosen deterministically per year+slot. */
export const PAPER_DIFFICULTIES = ['Moderate', 'Difficult', 'Easy-Moderate'] as const;

/**
 * Which year/slot combinations exist. Matches the prototype's `papersFor`:
 * two slots per year before 2020, three from 2020 onward.
 */
export function seededPapers(): { year: number; slot: number; difficulty: string }[] {
  const out: { year: number; slot: number; difficulty: string }[] = [];
  for (let year = 2015; year <= 2025; year++) {
    const slots = year >= 2020 ? 3 : 2;
    for (let slot = 1; slot <= slots; slot++) {
      const idx = (year * 3 + slot * 5) % 3;
      out.push({ year, slot, difficulty: PAPER_DIFFICULTIES[idx] ?? 'Moderate' });
    }
  }
  return out;
}
