'use client';

import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'mm_theme';

/**
 * Reads and writes the `data-cattheme` attribute the tokens key off. The initial value
 * is taken from the DOM rather than defaulted, so it agrees with the pre-paint script
 * in layout.tsx and does not cause a hydration mismatch.
 */
export function useTheme(): { theme: Theme; toggle: () => void; label: string; icon: string } {
  const [theme, setTheme] = useState<Theme>('light');

  useEffect(() => {
    const current = document.documentElement.getAttribute('data-cattheme');
    setTheme(current === 'dark' ? 'dark' : 'light');
  }, []);

  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next: Theme = prev === 'light' ? 'dark' : 'light';
      document.documentElement.setAttribute('data-cattheme', next);
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        /* private browsing — the attribute alone still applies for this session */
      }
      return next;
    });
  }, []);

  return {
    theme,
    toggle,
    label: theme === 'light' ? 'Dark mode' : 'Light mode',
    icon: theme === 'light' ? '◐' : '◑',
  };
}
