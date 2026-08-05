'use client';

import { useState, type FormEvent } from 'react';
import { SECTIONS } from '@mockmint/shared';
import { api, ApiRequestError } from '@/lib/api';
import { useAdminPapers } from '@/lib/admin';
import { useToast } from '@/lib/toast';
import ui from '@/components/ui/ui.module.css';
import styles from '../admin.module.css';

export default function AdminPapersPage() {
  const { papers, reload, loading } = useAdminPapers();
  const { flash } = useToast();

  const [year, setYear] = useState('2026');
  const [slot, setSlot] = useState('1');
  const [duration, setDuration] = useState('120');
  const [lock, setLock] = useState('40');
  const [difficulty, setDifficulty] = useState('Moderate');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function commit(status: 'draft' | 'live', event?: FormEvent) {
    event?.preventDefault();
    setError('');

    const y = Number(year);
    const s = Number(slot);
    const d = Number(duration);
    const l = Number(lock);

    if (!y || y < 2000 || y > 2100) return setError('Enter a four-digit year between 2000 and 2100.');
    if (!s || s < 1 || s > 4) return setError('Slot must be between 1 and 4.');
    if (!d || d < 30) return setError('Duration must be at least 30 minutes.');
    if (!l || l * 3 > d) {
      return setError(`Three sectional locks of ${lock} min do not fit in ${duration} min.`);
    }

    setBusy(true);
    try {
      const res = await api.post<{ message: string }>('/api/admin/papers', {
        year: y,
        slot: s,
        durationMin: d,
        sectionLockMin: l,
        difficulty,
        status,
      });
      flash(res.message);
      setSlot(String(s + 1));
      reload();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not create that paper.');
    } finally {
      setBusy(false);
    }
  }

  async function togglePublish(id: string, isLive: boolean) {
    try {
      const res = await api.post<{ message: string }>(
        `/api/admin/papers/${id}/${isLive ? 'unpublish' : 'publish'}`,
      );
      flash(res.message);
      reload();
    } catch (err) {
      flash(err instanceof ApiRequestError ? err.message : 'Could not update that paper');
    }
  }

  async function remove(id: string, name: string) {
    if (!window.confirm(`Delete ${name}? Its question bank goes with it.`)) return;
    try {
      await api.delete(`/api/admin/papers/${id}`);
      flash(`${name} deleted`);
      reload();
    } catch (err) {
      flash(err instanceof ApiRequestError ? err.message : 'Could not delete that paper');
    }
  }

  return (
    <div className={styles.papersGrid} style={{ animation: 'catfade .3s ease' }}>
      <form className={ui.card} style={{ padding: 22, height: 'fit-content' }} onSubmit={(e) => void commit('live', e)}>
        <div className={ui.cardTitle} style={{ marginBottom: 16 }}>
          Create paper
        </div>

        <div className={styles.builderGrid}>
          <div>
            <label className={ui.label}>Year</label>
            <input className={ui.input} value={year} onChange={(e) => setYear(e.target.value)} />
          </div>
          <div>
            <label className={ui.label}>Slot</label>
            <input className={ui.input} value={slot} onChange={(e) => setSlot(e.target.value)} />
          </div>
          <div>
            <label className={ui.label}>Duration (min)</label>
            <input
              className={ui.input}
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
            />
          </div>
          <div>
            <label className={ui.label}>Sectional lock (min)</label>
            <input className={ui.input} value={lock} onChange={(e) => setLock(e.target.value)} />
          </div>
          <div className={styles.builderWide}>
            <label className={ui.label}>Difficulty label</label>
            <select
              className={ui.select}
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value)}
            >
              <option value="Easy-Moderate">Easy-Moderate</option>
              <option value="Moderate">Moderate</option>
              <option value="Difficult">Difficult</option>
            </select>
          </div>
        </div>

        {error ? (
          <div className={ui.errorBox} style={{ marginTop: 13 }} role="alert">
            {error}
          </div>
        ) : null}

        <div className={styles.builderSections}>
          {SECTIONS.map((section) => (
            <div key={section.key} className={styles.builderSection}>
              <div className={styles.builderKey}>{section.key}</div>
              <div className={styles.builderNote}>
                {lock} min sectional lock · {Math.round(section.count * 0.2)} TITA
              </div>
              <div className={styles.builderCount}>{section.count} Q</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 9 }}>
          <button
            type="button"
            className={ui.btn}
            style={{ flex: 1, padding: 11 }}
            onClick={() => void commit('draft')}
            disabled={busy}
          >
            Save draft
          </button>
          <button
            type="submit"
            className={ui.btnPrimary}
            style={{ flex: 1, padding: 11 }}
            disabled={busy}
          >
            Publish
          </button>
        </div>
      </form>

      <div className={`${ui.cardFlush} ${ui.tableScroll}`}>
        <div className={`${ui.tableHead} ${styles.paperRow}`}>
          <div>Paper</div>
          <div>Qs</div>
          <div>Attempts</div>
          <div>Status</div>
          <div />
        </div>

        {loading ? (
          <div className={ui.loading}>Loading papers…</div>
        ) : (
          papers.map((paper) => {
            const isLive = paper.status === 'live';
            return (
              <div key={paper.id} className={`${ui.tableRow} ${styles.paperRow}`}>
                <div>
                  <div className={styles.paperName}>{paper.name}</div>
                  <div className={styles.paperMeta}>{paper.meta}</div>
                </div>
                <div className={ui.mono} style={{ fontSize: 12, fontWeight: 600 }}>
                  {paper.questions}
                </div>
                <div className={ui.mono} style={{ fontSize: 12, color: 'var(--ink2)' }}>
                  {paper.attempts.toLocaleString('en-IN')}
                </div>
                <div
                  className={`${ui.chip} ${isLive ? ui.chipOk : ui.chipWarn}`}
                  style={{ justifySelf: 'start' }}
                >
                  {isLive ? 'Live' : 'Draft'}
                </div>
                <div className={styles.rowActions}>
                  <button
                    type="button"
                    className={`${ui.btn} ${ui.btnSmall}`}
                    onClick={() => void togglePublish(paper.id, isLive)}
                  >
                    {isLive ? 'Unpublish' : 'Publish'}
                  </button>
                  {paper.canDelete ? (
                    <button
                      type="button"
                      className={`${ui.btn} ${ui.btnSmall} ${ui.btnDanger}`}
                      onClick={() => void remove(paper.id, paper.name)}
                    >
                      Delete
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
