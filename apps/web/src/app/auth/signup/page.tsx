'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { ApiRequestError } from '@/lib/api';
import styles from '../auth.module.css';

export default function SignupPage() {
  const { signUp } = useAuth();
  const router = useRouter();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Three segments: any input, 8+ characters, 12+ characters.
  const strength = password.length >= 12 ? 3 : password.length >= 8 ? 2 : password.length > 0 ? 1 : 0;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');

    if (name.trim().length < 3) return setError('Tell us your name.');
    if (!email.includes('@')) return setError('Enter a valid email address.');
    if (password.length < 8) return setError('Use at least 8 characters.');

    setSubmitting(true);
    try {
      await signUp(name, email, password);
      router.replace('/app');
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : 'Could not create the account. Try again.',
      );
      setSubmitting(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      <h2 className={styles.title}>Create your account</h2>
      <p className={styles.subtitle}>Free. Every paper, every slot.</p>

      <label className={styles.label} htmlFor="name">
        Full name
      </label>
      <input
        id="name"
        className={styles.input}
        autoComplete="name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Aarav Sharma"
      />

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

      <label className={styles.label} htmlFor="password">
        Password
      </label>
      <input
        id="password"
        type="password"
        autoComplete="new-password"
        className={styles.input}
        style={{ marginBottom: 10 }}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="8+ characters"
      />

      <div className={styles.strength} aria-hidden>
        <div className={styles.strengthBar} data-on={strength >= 1 ? '1' : undefined} />
        <div className={styles.strengthBar} data-on={strength >= 2 ? '2' : undefined} />
        <div className={styles.strengthBar} data-on={strength >= 3 ? '3' : undefined} />
      </div>

      {error ? (
        <div className={styles.error} role="alert">
          {error}
        </div>
      ) : null}

      <button type="submit" className={styles.submit} disabled={submitting}>
        {submitting ? 'Creating…' : 'Create account'}
      </button>

      <p className={styles.footer}>
        Already registered?{' '}
        <Link href="/auth/login" className={styles.footerLink}>
          Sign in
        </Link>
      </p>
    </form>
  );
}
