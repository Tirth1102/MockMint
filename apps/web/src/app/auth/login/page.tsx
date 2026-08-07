'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { ApiRequestError } from '@/lib/api';
import styles from '../auth.module.css';

export default function LoginPage() {
  const { signIn, user, loading } = useAuth();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Already signed in (e.g. after a refresh) — skip straight through.
  useEffect(() => {
    if (!loading && user) router.replace(user.role === 'admin' ? '/admin' : '/app');
  }, [loading, user, router]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const next = await signIn(email, password);
      router.replace(next.role === 'admin' ? '/admin' : '/app');
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(err.message);
      } else if (err instanceof TypeError) {
        setError('Cannot reach the server — make sure the API is running on port 4000.');
      } else {
        setError('Could not sign in. Try again shortly.');
      }
      setSubmitting(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      <h2 className={styles.title}>Welcome back</h2>
      <p className={styles.subtitle}>Pick up where you left off.</p>

      <label className={styles.label} htmlFor="email">
        Email
      </label>
      <input
        id="email"
        type="email"
        autoComplete="email"
        className={styles.input}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@email.com"
      />

      <div className={styles.labelRow}>
        <label className={styles.label} htmlFor="password" style={{ marginBottom: 0 }}>
          Password
        </label>
        <Link href="/auth/forgot" className={styles.linkButton}>
          Forgot?
        </Link>
      </div>
      <input
        id="password"
        type="password"
        autoComplete="current-password"
        className={styles.input}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="••••••••"
      />

      {error ? (
        <div className={styles.error} role="alert">
          {error}
        </div>
      ) : null}

      <button type="submit" className={styles.submit} disabled={submitting}>
        {submitting ? 'Signing in…' : 'Sign in'}
      </button>

      <p className={styles.footer}>
        No account?{' '}
        <Link href="/auth/signup" className={styles.footerLink}>
          Create one
        </Link>
      </p>
    </form>
  );
}
