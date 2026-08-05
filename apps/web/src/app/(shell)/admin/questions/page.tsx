'use client';

import { useCallback, useEffect, useState } from 'react';
import type { AdminQuestion, Difficulty, QuestionType, SectionKey } from '@mockmint/shared';
import { api, ApiRequestError } from '@/lib/api';
import { useAdminPapers } from '@/lib/admin';
import { useToast } from '@/lib/toast';
import ui from '@/components/ui/ui.module.css';
import styles from '../admin.module.css';

type SectionFilter = 'all' | SectionKey;

const SECTION_FILTERS: { id: SectionFilter; label: string }[] = [
  { id: 'all', label: 'All sections' },
  { id: 'VARC', label: 'VARC' },
  { id: 'DILR', label: 'DILR' },
  { id: 'QA', label: 'QA' },
];

interface QuestionForm {
  id: string | null;
  sec: SectionKey;
  type: QuestionType;
  diff: Difficulty;
  topic: string;
  text: string;
  opts: string[];
  correctOption: number;
  titaAnswer: string;
  explanation: string;
  marks: string;
  neg: string;
}

function emptyForm(): QuestionForm {
  return {
    id: null,
    sec: 'QA',
    type: 'MCQ',
    diff: 'Medium',
    topic: 'Arithmetic · Ratios',
    text: '',
    opts: ['', '', '', ''],
    correctOption: 0,
    titaAnswer: '',
    explanation: '',
    marks: '3',
    neg: '1',
  };
}

export default function AdminQuestionsPage() {
  const { papers, selected, setSelected, selectedLabel, loading: papersLoading } = useAdminPapers();
  const { flash } = useToast();

  const [section, setSection] = useState<SectionFilter>('all');
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<AdminQuestion[]>([]);
  const [total, setTotal] = useState(0);
  const [bankCounts, setBankCounts] = useState<{ key: SectionKey; count: number }[]>([]);
  const [bankTotal, setBankTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState<QuestionForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const load = useCallback(async () => {
    if (!selected) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ paperId: selected, section, pageSize: '14' });
      if (search.trim()) params.set('q', search.trim());
      const data = await api.get<{
        items: AdminQuestion[];
        total: number;
        bankCounts: { key: SectionKey; count: number }[];
        bankTotal: number;
      }>(`/api/admin/questions?${params}`);
      setItems(data.items);
      setTotal(data.total);
      setBankCounts(data.bankCounts);
      setBankTotal(data.bankTotal);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [selected, section, search]);

  // Debounce the search box so typing does not fire a request per keystroke.
  useEffect(() => {
    const id = setTimeout(() => void load(), search ? 300 : 0);
    return () => clearTimeout(id);
  }, [load, search]);

  async function saveQuestion() {
    if (!form || !selected) return;
    setFormError('');

    if (!form.text.trim()) return setFormError('Question stem cannot be empty');
    if (form.type === 'MCQ' && form.opts.some((o) => !o.trim())) {
      return setFormError('All four options are required');
    }
    if (form.type === 'TITA' && !form.titaAnswer.trim()) {
      return setFormError('TITA answer is required');
    }

    setSaving(true);
    const body = {
      paperId: selected,
      sec: form.sec,
      type: form.type,
      diff: form.diff,
      topic: form.topic,
      text: form.text,
      opts: form.type === 'MCQ' ? form.opts : [],
      correctOption: form.type === 'MCQ' ? form.correctOption : null,
      titaAnswer: form.type === 'TITA' ? form.titaAnswer : null,
      explanation: form.explanation,
      marks: Number(form.marks) || 3,
      neg: form.type === 'TITA' ? 0 : Number(form.neg) || 0,
    };

    try {
      if (form.id) await api.patch(`/api/admin/questions/${form.id}`, body);
      else await api.post('/api/admin/questions', body);
      flash(form.id ? 'Question updated' : `Question added to ${selectedLabel}`);
      setForm(null);
      await load();
    } catch (err) {
      setFormError(err instanceof ApiRequestError ? err.message : 'Could not save the question');
    } finally {
      setSaving(false);
    }
  }

  async function deleteQuestion(question: AdminQuestion) {
    // Deleting a question also removes it from every past attempt's review, so confirm.
    if (!window.confirm(`Delete ${question.code}? This cannot be undone.`)) return;
    try {
      await api.delete(`/api/admin/questions/${question.id}`);
      flash('Question deleted');
      await load();
    } catch {
      flash('Could not delete that question');
    }
  }

  function editQuestion(question: AdminQuestion) {
    setFormError('');
    setForm({
      id: question.id,
      sec: question.sec,
      type: question.type,
      diff: question.diff,
      topic: question.topic,
      text: question.text,
      opts: question.type === 'MCQ' ? [...question.opts, '', '', '', ''].slice(0, 4) : ['', '', '', ''],
      correctOption: question.correctOption ?? 0,
      titaAnswer: question.titaAnswer ?? '',
      explanation: question.explanation,
      marks: String(question.marks),
      neg: String(question.neg),
    });
  }

  if (papersLoading) return <div className={ui.loading}>Loading papers…</div>;

  const bankSummary = bankCounts.map((c) => `${c.key} ${c.count}`).join(' · ');

  return (
    <div className={ui.page} style={{ gap: 14 }}>
      <div className={styles.toolbar}>
        <div className={styles.selectShell}>
          <span className={styles.selectLabel}>Paper</span>
          <select
            className={styles.bareSelect}
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            aria-label="Paper"
          >
            {papers.map((paper) => (
              <option key={paper.id} value={paper.id}>
                {paper.name}
                {paper.status === 'draft' ? ' (draft)' : ''}
              </option>
            ))}
          </select>
        </div>

        <div className={ui.searchBox} style={{ width: 240 }}>
          <span style={{ color: 'var(--ink3)' }} aria-hidden>
            ⌕
          </span>
          <input
            className={ui.searchBoxInput}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search stems, topics…"
            aria-label="Search questions"
          />
        </div>

        {SECTION_FILTERS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={ui.filter}
            data-active={section === entry.id}
            onClick={() => setSection(entry.id)}
          >
            {entry.label}
          </button>
        ))}

        <button
          type="button"
          className={`${ui.btnPrimary} ${styles.pushRight}`}
          onClick={() => {
            setFormError('');
            setForm(emptyForm());
          }}
        >
          + Add question
        </button>
      </div>

      <div className={`${ui.cardFlush} ${ui.tableScroll}`}>
        <div className={`${ui.tableHead} ${styles.questionRow}`}>
          <div>ID</div>
          <div>Section</div>
          <div>Type</div>
          <div>Stem</div>
          <div>Topic</div>
          <div>Level</div>
          <div />
        </div>

        {loading ? (
          <div className={ui.loading}>Loading questions…</div>
        ) : items.length === 0 ? (
          <div className={ui.loading} style={{ animation: 'none' }}>
            No questions match this filter.
          </div>
        ) : (
          items.map((question) => (
            <div key={question.id} className={`${ui.tableRow} ${styles.questionRow}`}>
              <div className={styles.code}>{question.code}</div>
              <div className={styles.sec}>{question.sec}</div>
              <div className={styles.type}>{question.type}</div>
              <div className={styles.stem} title={question.text}>
                {question.text}
              </div>
              <div className={styles.topic}>{question.topic}</div>
              <div
                className={`${ui.chip} ${
                  question.diff === 'Hard'
                    ? ui.chipBad
                    : question.diff === 'Easy'
                      ? ui.chipOk
                      : ui.chipWarn
                }`}
                style={{ justifySelf: 'start' }}
              >
                {question.diff}
              </div>
              <div className={styles.rowActions}>
                <button
                  type="button"
                  className={`${ui.btn} ${ui.btnSmall}`}
                  onClick={() => editQuestion(question)}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className={`${ui.btn} ${ui.btnSmall} ${ui.btnDanger}`}
                  onClick={() => void deleteQuestion(question)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))
        )}

        <div className={styles.tableFoot}>
          Showing {items.length} of {total} matching · {selectedLabel} bank holds {bankSummary} (
          {bankTotal} questions)
        </div>
      </div>

      {form ? (
        <QuestionModal
          form={form}
          setForm={setForm}
          error={formError}
          saving={saving}
          onSave={() => void saveQuestion()}
          onClose={() => setForm(null)}
          targetLabel={selectedLabel}
        />
      ) : null}
    </div>
  );
}

function QuestionModal({
  form,
  setForm,
  error,
  saving,
  onSave,
  onClose,
  targetLabel,
}: {
  form: QuestionForm;
  setForm: (next: QuestionForm) => void;
  error: string;
  saving: boolean;
  onSave: () => void;
  onClose: () => void;
  targetLabel: string;
}) {
  const patch = (next: Partial<QuestionForm>) => setForm({ ...form, ...next });

  return (
    <div className={ui.modalBackdrop} role="dialog" aria-modal="true">
      <div className={`${ui.modal} ${styles.qModal}`}>
        <div className={styles.qModalHead}>
          <div>
            <div className={styles.qModalTitle}>{form.id ? 'Edit question' : 'Add question'}</div>
            <div className={styles.qModalSub}>
              {form.id ? 'Editing' : 'Will be added to'} {targetLabel}
            </div>
          </div>
          <button type="button" className={styles.qModalClose} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className={styles.qModalBody}>
          <div className={styles.quadGrid}>
            <div>
              <label className={ui.label}>Section</label>
              <select
                className={ui.select}
                value={form.sec}
                onChange={(e) => patch({ sec: e.target.value as SectionKey })}
              >
                <option value="VARC">VARC</option>
                <option value="DILR">DILR</option>
                <option value="QA">QA</option>
              </select>
            </div>
            <div>
              <label className={ui.label}>Type</label>
              <select
                className={ui.select}
                value={form.type}
                onChange={(e) =>
                  patch({
                    type: e.target.value as QuestionType,
                    // TITA never carries a penalty.
                    neg: e.target.value === 'TITA' ? '0' : '1',
                  })
                }
              >
                <option value="MCQ">MCQ</option>
                <option value="TITA">TITA</option>
              </select>
            </div>
            <div>
              <label className={ui.label}>Difficulty</label>
              <select
                className={ui.select}
                value={form.diff}
                onChange={(e) => patch({ diff: e.target.value as Difficulty })}
              >
                <option value="Easy">Easy</option>
                <option value="Medium">Medium</option>
                <option value="Hard">Hard</option>
              </select>
            </div>
            <div>
              <label className={ui.label}>Topic</label>
              <input
                className={ui.input}
                value={form.topic}
                onChange={(e) => patch({ topic: e.target.value })}
              />
            </div>
          </div>

          <div>
            <label className={ui.label}>Question stem</label>
            <textarea
              className={ui.textarea}
              rows={3}
              value={form.text}
              onChange={(e) => patch({ text: e.target.value })}
            />
          </div>

          {form.type === 'MCQ' ? (
            <div className={styles.optionRows}>
              <label className={ui.label} style={{ marginBottom: 0 }}>
                Options — click the circle to set the correct answer
              </label>
              {form.opts.map((option, i) => (
                <div key={i} className={styles.optionRow}>
                  <button
                    type="button"
                    className={styles.optionPick}
                    data-correct={form.correctOption === i}
                    onClick={() => patch({ correctOption: i })}
                    aria-label={`Mark option ${'ABCD'[i]} correct`}
                  >
                    {'ABCD'[i]}
                  </button>
                  <input
                    className={ui.input}
                    value={option}
                    placeholder="Option text"
                    onChange={(e) => {
                      const opts = [...form.opts];
                      opts[i] = e.target.value;
                      patch({ opts });
                    }}
                  />
                </div>
              ))}
            </div>
          ) : (
            <div>
              <label className={ui.label}>Correct answer (exact match)</label>
              <input
                className={ui.input}
                style={{ width: 200, font: '600 14px var(--font-mono)' }}
                value={form.titaAnswer}
                onChange={(e) => patch({ titaAnswer: e.target.value })}
              />
            </div>
          )}

          <div>
            <label className={ui.label}>Explanation</label>
            <textarea
              className={ui.textarea}
              rows={3}
              value={form.explanation}
              onChange={(e) => patch({ explanation: e.target.value })}
            />
          </div>

          <div className={styles.tripleGrid}>
            <div>
              <label className={ui.label}>Marks</label>
              <input
                className={ui.input}
                value={form.marks}
                onChange={(e) => patch({ marks: e.target.value })}
              />
            </div>
            <div>
              <label className={ui.label}>Negative marks</label>
              <input
                className={ui.input}
                value={form.neg}
                disabled={form.type === 'TITA'}
                onChange={(e) => patch({ neg: e.target.value })}
              />
            </div>
            <div>
              <label className={ui.label}>Image</label>
              <button
                type="button"
                className={ui.btn}
                style={{ width: '100%', borderStyle: 'dashed' }}
                disabled
                title="Needs the signed S3 upload endpoint"
              >
                ⇪ Attach
              </button>
            </div>
          </div>

          {error ? (
            <div className={ui.errorBox} role="alert">
              {error}
            </div>
          ) : null}
        </div>

        <div className={styles.qModalFoot}>
          <button type="button" className={ui.btn} onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" className={ui.btnPrimary} onClick={onSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save question'}
          </button>
        </div>
      </div>
    </div>
  );
}
