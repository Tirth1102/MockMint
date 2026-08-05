'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { forgotPassword } from '@/lib/api';
import styles from '../auth.module.css';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    try {
      await forgotPassword(email);
    } catch {
      /* The endpoint always answers 202; a network blip should not leak account state. */
    }
    // Always the same confirmation, whether or not the address is registered.
    setSent(true);
    setSubmitting(false);
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      <h2 className={styles.title}>Reset password</h2>
      <p className={styles.subtitle}>
        We&apos;ll email you a secure link that expires in 30 minutes.
      </p>

      {sent ? (
        <div className={styles.notice} role="status">
          If an account exists for {email}, a reset link is on its way.
        </div>
      ) : null}

      <label className={styles.label} htmlFor="email">
        Email
      </label>
      <input
        id="email"
        type="email"
        autoComplete="email"
        className={styles.input}
        style={{ marginBottom: 20 }}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@email.com"
      />

      <button type="submit" className={styles.submit} disabled={submitting || sent}>
        {submitting ? 'Sending…' : 'Send reset link'}
      </button>

      <p className={styles.footer}>
        <Link href="/auth/login" className={styles.footerLink}>
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
