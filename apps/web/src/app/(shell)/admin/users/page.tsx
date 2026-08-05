'use client';

import { useCallback, useEffect, useState } from 'react';
import type { AdminUserRow } from '@mockmint/shared';
import { api, ApiRequestError } from '@/lib/api';
import { useToast } from '@/lib/toast';
import ui from '@/components/ui/ui.module.css';
import styles from '../admin.module.css';

export default function AdminUsersPage() {
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<AdminUserRow[]>([]);
  const [loading, setLoading] = useState(true);
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
    // Optimistic flip; the row reverts if the call fails.
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
    if (
      !window.confirm(
        `Delete ${user.name}? Their attempts, responses and bookmarks are removed with them.`,
      )
    ) {
      return;
    }
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
                  onClick={() => void remove(user)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
