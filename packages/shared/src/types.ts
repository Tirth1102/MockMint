import type { SectionKey } from './sections.js';

export type Role = 'student' | 'admin';
export type QuestionType = 'MCQ' | 'TITA';
export type Difficulty = 'Easy' | 'Medium' | 'Hard';
export type PaperStatus = 'draft' | 'live' | 'retired';
export type AttemptStatus = 'in_progress' | 'submitted' | 'expired';

export const DIFFICULTIES: readonly Difficulty[] = ['Easy', 'Medium', 'Hard'];

// ---------------------------------------------------------------- users

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  photoUrl: string | null;
  initials: string;
  targetPercentile: number | null;
  createdAt: string;
}

export interface AuthTokens {
  accessToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
}

export interface AuthResponse {
  user: User;
  tokens: AuthTokens;
}

// ---------------------------------------------------------------- papers

export interface PaperSection {
  key: SectionKey;
  position: number;
  questionCount: number;
  durationMin: number;
}

export interface Paper {
  id: string;
  year: number;
  slot: number;
  title: string;
  durationMin: number;
  totalMarks: number;
  difficulty: string;
  status: PaperStatus;
  questionCount: number;
  publishedAt: string | null;
}

export interface PaperDetail extends Paper {
  sections: PaperSection[];
}

/** A year group on the student Papers page. */
export interface PaperYearGroup {
  year: number;
  isNew: boolean;
  /** e.g. "66 questions · VARC 24 · DILR 20 · QA 22" */
  note: string;
  slots: PaperSlotCard[];
}

export interface PaperSlotCard extends Paper {
  /** Best score the requesting user has recorded on this paper, if any. */
  bestScore: number | null;
  pattern: string;
}

// ---------------------------------------------------------------- questions

/** A question as sent to a client mid-exam — answer key stripped. */
export interface ExamQuestion {
  id: string;
  /** 1-based index across the whole paper. */
  no: number;
  /** 1-based index within its own section. */
  secNo: number;
  sec: SectionKey;
  /** Index of the section in SECTIONS. */
  si: number;
  type: QuestionType;
  topic: string;
  diff: Difficulty;
  passage: string | null;
  passageLabel: string | null;
  text: string;
  /** Empty for TITA. */
  opts: string[];
  marks: number;
  /** Negative marks as a positive magnitude; always 0 for TITA. */
  neg: number;
  imageUrl: string | null;
}

/** A question with its answer key — only ever leaves the server post-submission. */
export interface ReviewQuestion extends ExamQuestion {
  /** Option index for MCQ, exact-match string for TITA. */
  answer: number | string;
  explanation: string;
}

/** Admin-facing question record, answer key included. */
export interface AdminQuestion {
  id: string;
  code: string;
  paperId: string;
  sec: SectionKey;
  position: number;
  type: QuestionType;
  topic: string;
  diff: Difficulty;
  passageId: string | null;
  text: string;
  opts: string[];
  correctOption: number | null;
  titaAnswer: string | null;
  explanation: string;
  marks: number;
  neg: number;
  imageUrl: string | null;
}

// ---------------------------------------------------------------- attempts

/** A single stored response. `answer` is null when the response was cleared. */
export interface AttemptResponse {
  questionId: string;
  answer: { option: number } | { text: string } | null;
  markedForReview: boolean;
  visited: boolean;
  timeSpentSec: number;
}

export interface Attempt {
  id: string;
  paperId: string;
  paper: Paper;
  status: AttemptStatus;
  currentSection: number;
  /** ISO timestamps, one per section, in SECTIONS order. Server-authoritative. */
  sectionDeadlines: string[];
  startedAt: string;
  submittedAt: string | null;
  autoSubmitted: boolean;
}

/** Payload returned by POST /api/attempts and GET /api/attempts/active. */
export interface AttemptPayload {
  attempt: Attempt;
  questions: ExamQuestion[];
  responses: AttemptResponse[];
  /** Server time at the moment of the response, so the client can compute drift. */
  serverNow: string;
}

// ---------------------------------------------------------------- results

export interface SectionResult {
  key: SectionKey;
  name: string;
  count: number;
  attempted: number;
  correct: number;
  wrong: number;
  skipped: number;
  /** Percentage of attempted questions that were correct. */
  acc: number;
  score: number;
  /** Maximum marks obtainable in the section. */
  max: number;
  timeSec: number;
}

export interface DifficultyAggregate {
  difficulty: Difficulty;
  attempted: number;
  correct: number;
}

export interface AttemptResult {
  attemptId: string;
  paperId: string;
  paperName: string;
  year: number;
  slot: number;
  submittedAt: string;
  score: number;
  totalMarks: number;
  correct: number;
  wrong: number;
  attempted: number;
  skipped: number;
  count: number;
  accuracy: number;
  /** Percentage of the paper the user attempted. */
  attemptRate: number;
  percentile: string;
  timeSec: number;
  sections: SectionResult[];
  difficultyAggregates: DifficultyAggregate[];
}

/** One row of the attempt history / results list. */
export interface ResultSummary {
  attemptId: string;
  paperId: string;
  name: string;
  year: number;
  slot: number;
  /** e.g. "12 Jun" */
  date: string;
  score: number;
  percentile: string;
  accuracy: number;
  sectionScores: number[];
}

export interface ReviewItem {
  question: ReviewQuestion;
  answer: { option: number } | { text: string } | null;
  isCorrect: boolean;
  marksAwarded: number;
  timeSpentSec: number;
  bookmarked: boolean;
}

export type ReviewFilter = 'all' | 'correct' | 'wrong' | 'skipped' | 'bookmarked';

export interface Suggestion {
  icon: string;
  tone: 'bad' | 'warn' | 'info' | 'ok';
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  title: string;
  body: string;
  tags: string[];
}

// ---------------------------------------------------------------- dashboard

export interface StatCard {
  label: string;
  value: string;
  unit: string;
  delta: string;
  deltaTone: 'ok' | 'bad' | 'muted';
}

export interface StrengthBar {
  label: SectionKey;
  pct: number;
  note: string;
}

export interface HeatCell {
  /** 0–4 intensity level. */
  level: number;
  title: string;
  date: string;
}

export interface DashboardPayload {
  greeting: string;
  line: string;
  statCards: StatCard[];
  trend: { label: string; score: number }[];
  strength: StrengthBar[];
  recent: ResultSummary[];
  coach: { headline: string; body: string };
  heat: HeatCell[];
  streakLine: string;
}

export interface CalendarPayload {
  heat: HeatCell[];
  stats: { v: string; k: string }[];
}

export interface Bookmark {
  questionId: string;
  no: number;
  sec: SectionKey;
  topic: string;
  text: string;
  createdAt: string;
}

export interface LeaderboardRow {
  rank: number;
  name: string;
  initials: string;
  score: number;
  percentile: string;
  isSelf: boolean;
}

export interface NotificationItem {
  id: string;
  kind: 'accent' | 'ok' | 'info' | 'warn';
  body: string;
  when: string;
  readAt: string | null;
}

// ---------------------------------------------------------------- admin

export interface AdminOverview {
  stats: { label: string; value: string; delta: string; tone: 'ok' | 'bad' | 'muted' }[];
  growth: { label: string; value: number }[];
  topPapers: { name: string; attempts: number }[];
  difficulty: { label: Difficulty; pct: number; note: string }[];
}

export interface AdminAnalytics {
  dau: number[];
  completion: { label: string; pct: number }[];
  yearAverages: { year: number; avg: number }[];
}

export interface AdminUserRow {
  id: string;
  name: string;
  email: string;
  initials: string;
  tests: number;
  best: number;
  percentile: string;
  blocked: boolean;
}

export type UploadRowStatus = 'OK' | 'WARN' | 'ERROR';

export interface UploadRowReport {
  row: string;
  status: UploadRowStatus;
  msg: string;
}

export interface UploadJob {
  id: string;
  filename: string;
  format: string;
  totalRows: number;
  validRows: number;
  warnings: number;
  errors: number;
  rows: UploadRowReport[];
  status: 'validated' | 'committed' | 'discarded';
}

// ---------------------------------------------------------------- api envelope

export interface ApiError {
  error: string;
  message: string;
  details?: unknown;
}
