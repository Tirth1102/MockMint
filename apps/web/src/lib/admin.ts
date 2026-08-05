'use client';

import { useEffect, useState } from 'react';
import { api } from './api';

export interface AdminPaperRow {
  id: string;
  year: number;
  slot: number;
  name: string;
  meta: string;
  questions: number;
  attempts: number;
  status: 'draft' | 'live' | 'retired';
  canDelete: boolean;
}

/**
 * Loads the admin paper list and keeps a selected paper id. Shared by the question bank
 * and the bulk-upload screen, which both need an "import into / edit" target.
 */
export function useAdminPapers(): {
  papers: AdminPaperRow[];
  selected: string;
  setSelected: (id: string) => void;
  selectedLabel: string;
  reload: () => void;
  loading: boolean;
} {
  const [papers, setPapers] = useState<AdminPaperRow[]>([]);
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .get<{ items: AdminPaperRow[] }>('/api/admin/papers')
      .then((data) => {
        if (cancelled) return;
        setPapers(data.items);
        // Default to the newest live paper so the screen is useful on first open.
        setSelected((current) => {
          if (current && data.items.some((p) => p.id === current)) return current;
          return data.items.find((p) => p.status === 'live')?.id ?? data.items[0]?.id ?? '';
        });
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  const selectedPaper = papers.find((p) => p.id === selected);

  return {
    papers,
    selected,
    setSelected,
    selectedLabel: selectedPaper
      ? `${selectedPaper.name}${selectedPaper.status === 'draft' ? ' (draft)' : ''}`
      : '—',
    reload: () => setNonce((n) => n + 1),
    loading,
  };
}
