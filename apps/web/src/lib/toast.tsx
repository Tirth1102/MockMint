'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import styles from './toast.module.css';

interface ToastState {
  flash: (message: string) => void;
}

const ToastContext = createContext<ToastState | null>(null);

/** Bottom-centre pill, 2.2s, matching the prototype's `flash()`. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flash = useCallback((next: string) => {
    setMessage(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(null), 2200);
  }, []);

  const value = useMemo(() => ({ flash }), [flash]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {message ? (
        <div className={styles.toast} role="status" aria-live="polite">
          {message}
        </div>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastState {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
