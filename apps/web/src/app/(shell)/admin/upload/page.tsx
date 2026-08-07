'use client';

import { useRef, useState, type DragEvent } from 'react';
import type { UploadRowReport } from '@mockmint/shared';
import { API_URL, apiRequest, ApiRequestError, getAccessToken } from '@/lib/api';
import { useAdminPapers } from '@/lib/admin';
import { useToast } from '@/lib/toast';
import ui from '@/components/ui/ui.module.css';
import styles from '../admin.module.css';

async function downloadTemplate() {
  const token = getAccessToken();
  const res = await fetch(`${API_URL}/api/admin/uploads/template`, {
    credentials: 'include',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) return;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'mockmint-questions-template.xlsx';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

interface UploadResult {
  jobId: string;
  filename: string;
  totalRows: number;
  validRows: number;
  warnings: number;
  errors: number;
  rows: UploadRowReport[];
}

const SCHEMA_TEXT = `section        VARC | DILR | QA
type           MCQ | TITA
passage_id     optional, groups RC/DI sets
stem           question text (markdown ok)
option_a..d    required when type = MCQ
correct        A|B|C|D  or  exact string for TITA
explanation    shown in post-test review
difficulty     Easy | Medium | Hard
topic          free text, used for analytics
marks          default 3
negative       default 1 (0 for TITA)`;

const FORMATS = [
  { ext: '.xlsx', note: 'Sheet 1, header row required' },
  { ext: '.csv', note: 'UTF-8, comma delimited' },
  { ext: '.json', note: 'Array of question objects' },
];

const STATUS_CLASS: Record<UploadRowReport['status'], string | undefined> = {
  OK: ui.chipOk,
  WARN: ui.chipWarn,
  ERROR: ui.chipBad,
};

export default function AdminUploadPage() {
  const { papers, selected, setSelected, selectedLabel, loading } = useAdminPapers();
  const { flash } = useToast();

  const [result, setResult] = useState<UploadResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    if (!selected) return flash('Choose a paper to import into first');

    setBusy(true);
    try {
      const body = new FormData();
      body.append('file', file);
      body.append('paperId', selected);
      // FormData must not carry a JSON content-type; apiRequest detects it and skips the header.
      const data = await apiRequest<UploadResult>('/api/admin/uploads', { method: 'POST', body });
      setResult(data);
      flash(`${data.totalRows} rows parsed from ${data.filename}`);
    } catch (err) {
      flash(err instanceof ApiRequestError ? err.message : 'Could not read that file');
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function commit() {
    if (!result) return;
    setBusy(true);
    try {
      const res = await apiRequest<{ message: string }>(
        `/api/admin/uploads/${result.jobId}/commit`,
        { method: 'POST' },
      );
      flash(`${res.message} into ${selectedLabel}`);
      setResult(null);
    } catch (err) {
      flash(err instanceof ApiRequestError ? err.message : 'Import failed — nothing was written');
    } finally {
      setBusy(false);
    }
  }

  async function discard() {
    if (!result) return;
    try {
      await apiRequest(`/api/admin/uploads/${result.jobId}`, { method: 'DELETE' });
    } catch {
      /* discarding is best-effort; the job simply stays 'validated' */
    }
    setResult(null);
    flash('Upload discarded');
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) void upload(file);
  }

  if (loading) return <div className={ui.loading}>Loading papers…</div>;

  return (
    <div className={styles.uploadGrid} style={{ animation: 'catfade .3s ease' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className={ui.card} style={{ padding: 22 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 11,
              marginBottom: 14,
              flexWrap: 'wrap',
            }}
          >
            <div className={ui.cardTitle}>Bulk upload questions</div>
            <div className={`${styles.selectShell} ${styles.pushRight}`} style={{ padding: '6px 10px' }}>
              <span className={styles.selectLabel}>Import into</span>
              <select
                className={styles.bareSelect}
                style={{ fontSize: 12.5 }}
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
                aria-label="Import into paper"
              >
                {papers.map((paper) => (
                  <option key={paper.id} value={paper.id}>
                    {paper.name}
                    {paper.status === 'draft' ? ' (draft)' : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div
            className={styles.dropzone}
            data-dragging={dragging}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <div className={styles.dropIcon} aria-hidden>
              ⇪
            </div>
            <div className={styles.dropTitle}>Drop an .xlsx, .csv or .json file</div>
            <div className={styles.dropSub}>
              Up to 2,000 rows per upload · validated before import
            </div>
            <input
              ref={fileInput}
              type="file"
              accept=".xlsx,.xlsm,.csv,.json"
              className="srOnly"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void upload(file);
              }}
            />
            <button
              type="button"
              className={ui.btnPrimary}
              onClick={() => fileInput.current?.click()}
              disabled={busy}
            >
              {busy ? 'Working…' : 'Choose file'}
            </button>
          </div>

          <div className={styles.formatRow}>
            {FORMATS.map((format) => (
              <div key={format.ext} className={styles.formatCard}>
                <div className={styles.formatExt}>{format.ext}</div>
                <div className={styles.formatNote}>{format.note}</div>
              </div>
            ))}
          </div>
        </div>

        <div className={ui.card} style={{ padding: 22 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              marginBottom: 13,
            }}
          >
            <div>
              <div className={ui.cardTitle}>Expected schema</div>
              <div className={ui.cardSub}>One row per question. Column order does not matter.</div>
            </div>
            <button
              type="button"
              className={ui.btnPrimary}
              style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }}
              onClick={() => void downloadTemplate()}
            >
              ⬇ Download template
            </button>
          </div>
          <div className={styles.schemaBlock}>{SCHEMA_TEXT}</div>
        </div>
      </div>

      <div className={ui.cardFlush} style={{ height: 'fit-content' }}>
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid var(--line2)',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <div className={ui.cardTitle}>Validation report</div>
          <div
            style={{
              marginLeft: 'auto',
              font: '600 12px var(--font-sans)',
              color: 'var(--ink3)',
            }}
          >
            {result
              ? `${result.totalRows} rows · ${result.validRows} valid · ${result.warnings} warnings · ${result.errors} errors`
              : 'No file yet'}
          </div>
        </div>

        {!result ? (
          <div
            style={{
              padding: '48px 24px',
              textAlign: 'center',
              font: '500 13px var(--font-sans)',
              color: 'var(--ink3)',
            }}
          >
            Upload a file to see row-level validation.
          </div>
        ) : (
          <>
            {result.rows.map((row) => (
              <div key={row.row} className={styles.reportRow}>
                <div className={styles.reportNo}>{row.row}</div>
                <div className={`${styles.reportStatus} ${STATUS_CLASS[row.status]}`}>
                  {row.status}
                </div>
                <div className={styles.reportMsg}>{row.msg}</div>
              </div>
            ))}

            <div style={{ padding: '16px 20px', display: 'flex', gap: 9 }}>
              <button type="button" className={ui.btn} onClick={() => void discard()} disabled={busy}>
                Discard
              </button>
              <button
                type="button"
                className={ui.btnPrimary}
                onClick={() => void commit()}
                disabled={busy || result.validRows === 0}
              >
                Import {result.validRows} valid rows
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export { API_URL };
