/**
 * Bulk question upload (ARCHITECTURE.md §5).
 *
 * Accepts .xlsx (sheet 1, header row), .csv (UTF-8) and .json (array of objects).
 * Validation runs over every row *before* any write; valid rows import, errored rows
 * come back for correction, and the commit is a single transaction.
 */
import ExcelJS from 'exceljs';
import type { Difficulty, QuestionType, SectionKey, UploadRowReport } from '@mockmint/shared';
import { isSectionKey } from '@mockmint/shared';
import { badRequest } from '../../lib/errors.js';

export interface ParsedQuestion {
  sectionKey: SectionKey;
  type: QuestionType;
  passageRef: string | null;
  stem: string;
  options: string[];
  correctOption: number | null;
  titaAnswer: string | null;
  explanation: string;
  difficulty: Difficulty;
  topic: string;
  marks: number;
  negativeMarks: number;
}

export interface ValidationOutcome {
  rows: UploadRowReport[];
  parsed: ParsedQuestion[];
  totalRows: number;
  validRows: number;
  warnings: number;
  errors: number;
}

type RawRow = Record<string, string>;

const DIFFICULTY_VALUES: Difficulty[] = ['Easy', 'Medium', 'Hard'];

export function detectFormat(filename: string): 'xlsx' | 'csv' | 'json' {
  const ext = filename.toLowerCase().split('.').pop();
  if (ext === 'xlsx' || ext === 'xlsm') return 'xlsx';
  if (ext === 'csv') return 'csv';
  if (ext === 'json') return 'json';
  throw badRequest('Upload a .xlsx, .csv or .json file.');
}

export async function parseFile(buffer: Buffer, format: 'xlsx' | 'csv' | 'json'): Promise<RawRow[]> {
  switch (format) {
    case 'json':
      return parseJson(buffer);
    case 'csv':
      return parseCsv(buffer.toString('utf8'));
    case 'xlsx':
      return parseXlsx(buffer);
  }
}

function parseJson(buffer: Buffer): RawRow[] {
  let data: unknown;
  try {
    data = JSON.parse(buffer.toString('utf8'));
  } catch {
    throw badRequest('That .json file is not valid JSON.');
  }
  if (!Array.isArray(data)) throw badRequest('The .json file must contain an array of objects.');

  return data.map((entry) => {
    const row: RawRow = {};
    if (entry && typeof entry === 'object') {
      for (const [key, value] of Object.entries(entry as Record<string, unknown>)) {
        row[normaliseHeader(key)] = value === null || value === undefined ? '' : String(value);
      }
    }
    return row;
  });
}

/** RFC-4180 CSV: handles quoted fields, escaped quotes and embedded newlines. */
export function parseCsv(text: string): RawRow[] {
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;

  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (inQuotes) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      record.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i++;
      record.push(field);
      records.push(record);
      record = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (field !== '' || record.length) {
    record.push(field);
    records.push(record);
  }

  const [header, ...body] = records.filter((r) => r.some((c) => c.trim() !== ''));
  if (!header) return [];

  const keys = header.map((h) => normaliseHeader(h));
  return body.map((cells) => {
    const row: RawRow = {};
    keys.forEach((key, i) => {
      row[key] = (cells[i] ?? '').trim();
    });
    return row;
  });
}

async function parseXlsx(buffer: Buffer): Promise<RawRow[]> {
  const workbook = new ExcelJS.Workbook();
  // ExcelJS types the reader against its own ArrayBuffer-ish shape.
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

  const sheet = workbook.worksheets[0];
  if (!sheet) throw badRequest('That workbook has no sheets.');

  const headerRow = sheet.getRow(1);
  const keys: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, col) => {
    keys[col - 1] = normaliseHeader(String(cell.value ?? ''));
  });

  const rows: RawRow[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const record: RawRow = {};
    let hasContent = false;
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      const key = keys[col - 1];
      if (!key) return;
      const value = cell.value;
      const text =
        value === null || value === undefined
          ? ''
          : typeof value === 'object' && 'text' in value
            ? String((value as { text: unknown }).text)
            : String(value);
      record[key] = text.trim();
      if (record[key]) hasContent = true;
    });
    if (hasContent) rows.push(record);
  });

  return rows;
}

function normaliseHeader(header: string): string {
  return header.trim().toLowerCase().replace(/\s+/g, '_');
}

/**
 * Validates every row and returns a per-row report alongside the questions that are
 * safe to import. Nothing is written here — the caller commits separately.
 */
export function validateRows(rows: RawRow[]): ValidationOutcome {
  const reports: UploadRowReport[] = [];
  const parsed: ParsedQuestion[] = [];
  let warnings = 0;
  let errors = 0;

  rows.forEach((row, index) => {
    // Row 1 is the header, so data starts at spreadsheet row 2.
    const label = `Row ${index + 2}`;
    const notes: string[] = [];

    const section = (row.section ?? '').trim().toUpperCase();
    if (!isSectionKey(section)) {
      errors++;
      reports.push({
        row: label,
        status: 'ERROR',
        msg: `section value "${row.section ?? ''}" is not one of VARC / DILR / QA.`,
      });
      return;
    }

    const rawType = (row.type ?? '').trim().toUpperCase();
    if (rawType !== 'MCQ' && rawType !== 'TITA') {
      errors++;
      reports.push({
        row: label,
        status: 'ERROR',
        msg: `type value "${row.type ?? ''}" is not one of MCQ / TITA.`,
      });
      return;
    }
    const type = rawType as QuestionType;

    const stem = (row.stem ?? '').trim();
    if (!stem) {
      errors++;
      reports.push({ row: label, status: 'ERROR', msg: 'stem is required and was empty.' });
      return;
    }

    const options = [row.option_a, row.option_b, row.option_c, row.option_d].map((o) =>
      (o ?? '').trim(),
    );
    const correctRaw = (row.correct ?? '').trim();

    let correctOption: number | null = null;
    let titaAnswer: string | null = null;

    if (type === 'MCQ') {
      const supplied = options.filter((o) => o !== '');
      if (supplied.length < 4) {
        errors++;
        reports.push({
          row: label,
          status: 'ERROR',
          msg: `MCQ needs option_a..option_d; only ${supplied.length} were supplied.`,
        });
        return;
      }
      const letterIndex = ['A', 'B', 'C', 'D'].indexOf(correctRaw.toUpperCase());
      if (letterIndex === -1) {
        errors++;
        reports.push({
          row: label,
          status: 'ERROR',
          msg: `correct is "${correctRaw}" but only 4 options were supplied — expected A, B, C or D.`,
        });
        return;
      }
      correctOption = letterIndex;
    } else {
      if (!correctRaw) {
        errors++;
        reports.push({
          row: label,
          status: 'ERROR',
          msg: 'TITA rows need an exact-match value in `correct`.',
        });
        return;
      }
      titaAnswer = correctRaw;
    }

    const explanation = (row.explanation ?? '').trim();
    if (!explanation) {
      notes.push('explanation missing — the row will import but show no explanation in review');
    }

    const difficultyRaw = (row.difficulty ?? '').trim();
    let difficulty: Difficulty = 'Medium';
    if (!difficultyRaw) {
      notes.push('difficulty missing — defaulted to Medium');
    } else {
      const match = DIFFICULTY_VALUES.find(
        (d) => d.toLowerCase() === difficultyRaw.toLowerCase(),
      );
      if (!match) {
        notes.push(`difficulty "${difficultyRaw}" not recognised — defaulted to Medium`);
      } else {
        difficulty = match;
      }
    }

    const topic = (row.topic ?? '').trim() || `${section} · Unclassified`;
    const marks = Number(row.marks ?? '') || 3;
    const negativeMarks = type === 'TITA' ? 0 : Number(row.negative ?? '') || 1;

    parsed.push({
      sectionKey: section,
      type,
      passageRef: (row.passage_id ?? '').trim() || null,
      stem,
      options: type === 'MCQ' ? options : [],
      correctOption,
      titaAnswer,
      explanation,
      difficulty,
      topic,
      marks,
      negativeMarks,
    });

    if (notes.length) {
      warnings++;
      reports.push({ row: label, status: 'WARN', msg: `${section} · ${topic} — ${notes.join('; ')}.` });
    } else {
      const answerNote = type === 'MCQ' ? `answer ${['A', 'B', 'C', 'D'][correctOption!]}` : `answer ${titaAnswer}`;
      reports.push({
        row: label,
        status: 'OK',
        msg: `${section} · ${topic} — ${type}, ${answerNote}, explanation present.`,
      });
    }
  });

  return {
    rows: reports,
    parsed,
    totalRows: rows.length,
    validRows: parsed.length,
    warnings,
    errors,
  };
}
