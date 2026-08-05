'use client';

import { useEffect, useState, type FormEvent } from 'react';
import type { User } from '@mockmint/shared';
import { api, ApiRequestError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useToast } from '@/lib/toast';
import ui from '@/components/ui/ui.module.css';
import styles from './profile.module.css';

interface ProfilePayload {
  user: User;
  stats: { tests: number; best: number; avgAccuracy: number; bookmarks: number };
}

export default function ProfilePage() {
  const { user, setUser } = useAuth();
  const { flash } = useToast();

  const [data, setData] = useState<ProfilePayload | null>(null);
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => {
    api
      .get<ProfilePayload>('/api/me')
      .then((payload) => {
        setData(payload);
        setName(payload.user.name);
        setTarget(payload.user.targetPercentile?.toString() ?? '');
      })
      .catch(() => undefined);
  }, []);

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    setSavingProfile(true);
    try {
      const parsed = target.trim() === '' ? null : Number(target);
      const payload = await api.patch<{ user: User }>('/api/me', {
        name: name.trim(),
        targetPercentile: Number.isFinite(parsed as number) ? parsed : null,
      });
      setUser(payload.user);
      setData((prev) => (prev ? { ...prev, user: payload.user } : prev));
      flash('Profile updated');
    } catch (err) {
      flash(err instanceof ApiRequestError ? err.message : 'Could not save your profile');
    } finally {
      setSavingProfile(false);
    }
  }

  async function savePassword(event: FormEvent) {
    event.preventDefault();
    setPasswordError('');

    if (next !== confirm) return setPasswordError('The new passwords do not match.');
    if (next.length < 8) return setPasswordError('Use at least 8 characters.');

    setSavingPassword(true);
    try {
      await api.post('/api/me/password', { current, next });
      setCurrent('');
      setNext('');
      setConfirm('');
      flash('Password updated — other devices have been signed out');
    } catch (err) {
      setPasswordError(
        err instanceof ApiRequestError ? err.message : 'Could not update your password.',
      );
    } finally {
      setSavingPassword(false);
    }
  }

  if (!data || !user) return <div className={ui.loading}>Loading your profile…</div>;

  const memberSince = new Date(data.user.createdAt)
    .toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
    .toUpperCase();

  return (
    <div className={styles.grid}>
      <div className={ui.card} style={{ padding: 24, height: 'fit-content' }}>
        <div className={styles.identity}>
          <div className={styles.bigAvatar} aria-hidden>
            {data.user.initials}
          </div>
          <div>
            <div className={styles.name}>{data.user.name}</div>
            <div className={styles.email}>{data.user.email}</div>
          </div>
          <div className={styles.since}>MEMBER SINCE {memberSince}</div>
          <button
            type="button"
            className={ui.btn}
            style={{ width: '100%', marginTop: 6 }}
            onClick={() => flash('Photo upload needs the S3 signing endpoint wired up')}
          >
            Upload photo
          </button>
        </div>

        <div className={styles.profileStats}>
          <Stat v={String(data.stats.tests)} k="Tests attempted" />
          <Stat v={String(data.stats.best)} k="Best score" />
          <Stat v={`${data.stats.avgAccuracy}%`} k="Avg accuracy" />
          <Stat v={String(data.stats.bookmarks)} k="Bookmarks" />
        </div>
      </div>

      <div className={styles.column}>
        <form className={ui.card} style={{ padding: 22 }} onSubmit={saveProfile}>
          <div className={ui.cardTitle} style={{ marginBottom: 16 }}>
            Account details
          </div>
          <div className={styles.fieldGrid}>
            <div>
              <label className={ui.label} htmlFor="name">
                Full name
              </label>
              <input
                id="name"
                className={ui.input}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div>
              <label className={ui.label} htmlFor="email">
                Email
              </label>
              <input id="email" className={ui.input} value={data.user.email} readOnly disabled />
            </div>
            <div>
              <label className={ui.label} htmlFor="target">
                Target percentile
              </label>
              <input
                id="target"
                className={ui.input}
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder="99.2"
                inputMode="decimal"
              />
            </div>
            <div>
              <label className={ui.label} htmlFor="role">
                Role
              </label>
              <input
                id="role"
                className={ui.input}
                value={data.user.role === 'admin' ? 'Administrator' : 'Student'}
                readOnly
                disabled
              />
            </div>
          </div>
          <button
            type="submit"
            className={ui.btnPrimary}
            style={{ marginTop: 16 }}
            disabled={savingProfile}
          >
            {savingProfile ? 'Saving…' : 'Save changes'}
          </button>
        </form>

        <form className={ui.card} style={{ padding: 22 }} onSubmit={savePassword}>
          <div className={ui.cardTitle} style={{ marginBottom: 16 }}>
            Change password
          </div>
          <div className={styles.passwordGrid}>
            <input
              className={ui.input}
              type="password"
              autoComplete="current-password"
              placeholder="Current"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
            <input
              className={ui.input}
              type="password"
              autoComplete="new-password"
              placeholder="New"
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
            <input
              className={ui.input}
              type="password"
              autoComplete="new-password"
              placeholder="Confirm new"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>

          {passwordError ? (
            <div className={ui.errorBox} style={{ marginTop: 12 }} role="alert">
              {passwordError}
            </div>
          ) : null}

          <button type="submit" className={ui.btn} style={{ marginTop: 14 }} disabled={savingPassword}>
            {savingPassword ? 'Updating…' : 'Update password'}
          </button>
        </form>
      </div>
    </div>
  );
}

function Stat({ v, k }: { v: string; k: string }) {
  return (
    <div>
      <div className={styles.statValue}>{v}</div>
      <div className={styles.statLabel}>{k}</div>
    </div>
  );
}
