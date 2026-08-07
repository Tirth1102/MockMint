'use client';

import { useCallback, useEffect, useState } from 'react';
import type { AdminUserRow } from '@mockmint/shared';
import { API_URL, api, ApiRequestError } from '@/lib/api';
import { useToast } from '@/lib/toast';
import ui from '@/components/ui/ui.module.css';
import styles from '../admin.module.css';

export default function AdminUsersPage() {
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<AdminUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<AdminUserRow | null>(null);
  const { flash } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set('q', search.trim());
      const data = await api.get<{ items: AdminUserRow[] }>(`/api/admin/users?${params}`);
      setItems(data.items);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    const id = setTimeout(() => void load(), search ? 300 : 0);
    return () => clearTimeout(id);
  }, [load, search]);

  async function resetPassword(user: AdminUserRow) {
    try {
      const res = await api.post<{ message: string; temporaryPassword: string }>(
        `/api/admin/users/${user.id}/reset-password`,
      );
      flash(`${res.message} · temporary password ${res.temporaryPassword}`);
    } catch (err) {
      flash(err instanceof ApiRequestError ? err.message : 'Could not reset that password');
    }
  }

  async function toggleBlock(user: AdminUserRow) {
    setItems((prev) =>
      prev.map((u) => (u.id === user.id ? { ...u, blocked: !u.blocked } : u)),
    );
    try {
      const res = await api.post<{ message: string }>(`/api/admin/users/${user.id}/block`);
      flash(res.message);
    } catch (err) {
      setItems((prev) => prev.map((u) => (u.id === user.id ? { ...u, blocked: user.blocked } : u)));
      flash(err instanceof ApiRequestError ? err.message : 'Could not update that account');
    }
  }

  async function remove(user: AdminUserRow) {
    try {
      const res = await api.delete<{ message: string }>(`/api/admin/users/${user.id}`);
      flash(res.message);
      await load();
    } catch (err) {
      flash(err instanceof ApiRequestError ? err.message : 'Could not delete that account');
    }
  }

  return (
    <div className={ui.page} style={{ gap: 14 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <div className={ui.searchBox} style={{ width: 300 }}>
          <span style={{ color: 'var(--ink3)' }} aria-hidden>
            ⌕
          </span>
          <input
            className={ui.searchBoxInput}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or email…"
            aria-label="Search users"
          />
        </div>
        <button
          type="button"
          className={`${ui.btnPrimary} ${styles.pushRight}`}
          onClick={() => setAddOpen(true)}
        >
          + Add user
        </button>
      </div>

      <div className={`${ui.cardFlush} ${ui.tableScroll}`}>
        <div className={`${ui.tableHead} ${styles.userRow}`}>
          <div>User</div>
          <div>Tests</div>
          <div>Best</div>
          <div>Avg %ile</div>
          <div>Status</div>
          <div />
        </div>

        {loading ? (
          <div className={ui.loading}>Loading users…</div>
        ) : items.length === 0 ? (
          <div className={ui.loading} style={{ animation: 'none' }}>
            No accounts match that search.
          </div>
        ) : (
          items.map((user) => (
            <div key={user.id} className={`${ui.tableRow} ${styles.userRow}`}>
              <div className={styles.userCell}>
                <div className={styles.userAvatar} aria-hidden>
                  {user.initials}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div className={styles.userName}>{user.name}</div>
                  <div className={styles.userEmail}>{user.email}</div>
                </div>
              </div>
              <div className={ui.mono} style={{ fontSize: 12, fontWeight: 600 }}>
                {user.tests}
              </div>
              <div className={ui.mono} style={{ fontSize: 12, fontWeight: 600 }}>
                {user.best}
              </div>
              <div className={ui.mono} style={{ fontSize: 12, color: 'var(--accent)' }}>
                {user.percentile}
              </div>
              <div
                className={`${ui.chip} ${user.blocked ? ui.chipBad : ui.chipOk}`}
                style={{ justifySelf: 'start' }}
              >
                {user.blocked ? 'Blocked' : 'Active'}
              </div>
              <div className={styles.rowActions}>
                <button
                  type="button"
                  className={`${ui.btn} ${ui.btnSmall}`}
                  onClick={() => void resetPassword(user)}
                >
                  Reset
                </button>
                <button
                  type="button"
                  className={`${ui.btn} ${ui.btnSmall} ${ui.btnWarn}`}
                  onClick={() => void toggleBlock(user)}
                >
                  {user.blocked ? 'Unblock' : 'Block'}
                </button>
                <button
                  type="button"
                  className={`${ui.btn} ${ui.btnSmall} ${ui.btnDanger}`}
                  onClick={() => setConfirmDelete(user)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {confirmDelete ? (
        <div className={ui.modalBackdrop} role="dialog" aria-modal="true">
          <div className={ui.modal} style={{ maxWidth: 420 }}>
            <div className={ui.modalPad}>
              <div className={ui.modalTitle}>Delete account?</div>
              <div className={ui.modalBody}>
                <strong>{confirmDelete.name}</strong> ({confirmDelete.email}) and all their
                attempts, responses and bookmarks will be permanently removed. This cannot be undone.
              </div>
              <div className={ui.modalActions}>
                <button
                  type="button"
                  className={ui.btn}
                  onClick={() => setConfirmDelete(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className={ui.btnPrimary}
                  style={{ background: 'var(--bad)', borderColor: 'var(--bad)' }}
                  onClick={() => {
                    const user = confirmDelete;
                    setConfirmDelete(null);
                    void remove(user);
                  }}
                >
                  Yes, delete
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {addOpen ? (
        <AddUserModal
          onClose={() => setAddOpen(false)}
          onCreated={async () => {
            setAddOpen(false);
            await load();
          }}
          flash={flash}
        />
      ) : null}
    </div>
  );
}

function AddUserModal({
  onClose,
  onCreated,
  flash,
}: {
  onClose: () => void;
  onCreated: () => Promise<void>;
  flash: (msg: string) => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'student' | 'admin'>('student');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit() {
    setError('');
    if (!name.trim()) return setError('Name is required');
    if (!email.trim()) return setError('Email is required');
    if (password.length < 8) return setError('Password must be at least 8 characters');

    setSaving(true);
    try {
      const res = await api.post<{ message: string }>('/api/admin/users', {
        name: name.trim(),
        email: email.trim().toLowerCase(),
        password,
        role,
      });
      flash(res.message);
      await onCreated();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not create the account');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={ui.modalBackdrop} role="dialog" aria-modal="true">
      <div className={ui.modal} style={{ maxWidth: 460 }}>
        <div
          style={{
            padding: '20px 24px',
            borderBottom: '1px solid var(--line2)',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <div style={{ font: '700 15.5px var(--font-sans)' }}>Add user</div>
          <button
            type="button"
            style={{
              marginLeft: 'auto',
              background: 'none',
              border: 'none',
              color: 'var(--ink3)',
              cursor: 'pointer',
              fontSize: 15,
            }}
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div style={{ padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label className={ui.label}>Full name</label>
            <input
              className={ui.input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Aarav Shah"
              autoFocus
            />
          </div>
          <div>
            <label className={ui.label}>Email</label>
            <input
              className={ui.input}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="student@example.com"
            />
          </div>
          <div>
            <label className={ui.label}>Password</label>
            <input
              className={ui.input}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Min 8 characters"
            />
          </div>
          <div>
            <label className={ui.label}>Role</label>
            <select
              className={ui.select}
              value={role}
              onChange={(e) => setRole(e.target.value as 'student' | 'admin')}
            >
              <option value="student">Student</option>
              <option value="admin">Admin</option>
            </select>
          </div>

          {error ? (
            <div className={ui.errorBox} role="alert">
              {error}
            </div>
          ) : null}
        </div>

        <div
          style={{
            padding: '18px 24px',
            borderTop: '1px solid var(--line2)',
            display: 'flex',
            gap: 10,
            justifyContent: 'flex-end',
          }}
        >
          <button type="button" className={ui.btn} onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" className={ui.btnPrimary} onClick={() => void submit()} disabled={saving}>
            {saving ? 'Creating…' : 'Create account'}
          </button>
        </div>
      </div>
    </div>
  );
}

export { API_URL };
