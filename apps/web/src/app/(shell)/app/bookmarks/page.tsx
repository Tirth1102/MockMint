'use client';

import { useEffect, useState } from 'react';
import type { Bookmark } from '@mockmint/shared';
import { api } from '@/lib/api';
import { useToast } from '@/lib/toast';
import ui from '@/components/ui/ui.module.css';
import styles from './bookmarks.module.css';

export default function BookmarksPage() {
  const [items, setItems] = useState<Bookmark[] | null>(null);
  const { flash } = useToast();

  useEffect(() => {
    api
      .get<{ items: Bookmark[] }>('/api/me/bookmarks')
      .then((data) => setItems(data.items))
      .catch(() => setItems([]));
  }, []);

  async function remove(questionId: string) {
    // Optimistic: the row disappears immediately and is restored if the call fails.
    const previous = items;
    setItems((current) => current?.filter((i) => i.questionId !== questionId) ?? null);
    try {
      await api.delete(`/api/me/bookmarks/${questionId}`);
      flash('Bookmark removed');
    } catch {
      setItems(previous ?? null);
      flash('Could not remove that bookmark');
    }
  }

  if (!items) return <div className={ui.loading}>Loading bookmarks…</div>;

  if (items.length === 0) {
    return (
      <div className={ui.empty}>
        <div className={ui.emptyIcon}>☆</div>
        <div className={ui.emptyTitle}>No bookmarks yet</div>
        <div className={ui.emptyBody}>
          Star a question during a test or in review and it lands here.
        </div>
      </div>
    );
  }

  return (
    <div className={ui.page} style={{ gap: 12 }}>
      {items.map((item) => (
        <div key={item.questionId} className={styles.card}>
          <div className={styles.head}>
            <div className={styles.no}>Q{item.no}</div>
            <div className={ui.chip}>{item.sec}</div>
            <div className={ui.chip}>{item.topic}</div>
            <button
              type="button"
              className={styles.remove}
              onClick={() => void remove(item.questionId)}
            >
              Remove
            </button>
          </div>
          <div className={styles.text}>{item.text}</div>
        </div>
      ))}
    </div>
  );
}
