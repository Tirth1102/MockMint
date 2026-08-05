'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { NotificationItem } from '@mockmint/shared';
import { useAuth } from '@/lib/auth-context';
import { useTheme } from '@/lib/theme';
import { api } from '@/lib/api';
import styles from './Shell.module.css';

interface NavEntry {
  href: string;
  label: string;
  icon: string;
  title: string;
  sub: string;
}

const STUDENT_NAV: NavEntry[] = [
  { href: '/app', label: 'Dashboard', icon: '◈', title: 'Dashboard', sub: 'Your preparation at a glance' },
  { href: '/app/papers', label: 'Papers', icon: '▤', title: 'Question papers', sub: 'Year-wise CAT papers, slot by slot' },
  { href: '/app/results', label: 'Results', icon: '◫', title: 'Results', sub: 'Every attempt you have saved' },
  { href: '/app/bookmarks', label: 'Bookmarks', icon: '☆', title: 'Bookmarked questions', sub: 'Saved for another look' },
  { href: '/app/calendar', label: 'Calendar', icon: '▦', title: 'Practice calendar', sub: 'Consistency over intensity' },
  { href: '/app/leaderboard', label: 'Leaderboard', icon: '▲', title: 'Leaderboard', sub: 'This month, all papers' },
  { href: '/app/profile', label: 'Profile', icon: '◍', title: 'Profile', sub: 'Account, preferences and security' },
];

const ADMIN_NAV: NavEntry[] = [
  { href: '/admin', label: 'Overview', icon: '◈', title: 'Admin overview', sub: 'Platform health at a glance' },
  { href: '/admin/questions', label: 'Questions', icon: '▤', title: 'Question bank', sub: 'Add, edit and retire questions' },
  { href: '/admin/papers', label: 'Papers', icon: '◫', title: 'Paper management', sub: 'Build and publish year-slot papers' },
  { href: '/admin/upload', label: 'Bulk upload', icon: '⇪', title: 'Bulk upload', sub: 'XLSX, CSV or JSON with validation' },
  { href: '/admin/users', label: 'Users', icon: '◍', title: 'User management', sub: 'Search, block, reset and inspect' },
  { href: '/admin/analytics', label: 'Analytics', icon: '▲', title: 'Analytics', sub: 'Growth, engagement and difficulty' },
];

const DOT_BY_KIND: Record<NotificationItem['kind'], string> = {
  accent: 'var(--accent)',
  ok: 'var(--ok)',
  info: 'var(--info)',
  warn: 'var(--warn)',
};

/** Longest matching nav href wins, so /app/papers beats /app. */
function activeEntry(pathname: string, entries: NavEntry[]): NavEntry | null {
  let best: NavEntry | null = null;
  for (const entry of entries) {
    if (pathname === entry.href || pathname.startsWith(`${entry.href}/`)) {
      if (!best || entry.href.length > best.href.length) best = entry;
    }
  }
  return best;
}

export function Shell({
  children,
  search,
  onSearchChange,
  bookmarkCount = 0,
}: {
  children: React.ReactNode;
  search?: string;
  onSearchChange?: (value: string) => void;
  bookmarkCount?: number;
}) {
  const { user, isAdmin, signOut } = useAuth();
  const theme = useTheme();
  const pathname = usePathname();
  const router = useRouter();

  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    api
      .get<{ items: NotificationItem[]; unread: number }>('/api/me/notifications')
      .then((data) => {
        setNotifications(data.items);
        setUnread(data.unread);
      })
      .catch(() => {
        /* the bell degrades to empty rather than breaking the shell */
      });
  }, []);

  // Close the popover on Escape, matching the ✕ affordance.
  useEffect(() => {
    if (!notifOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setNotifOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [notifOpen]);

  const current =
    activeEntry(pathname, ADMIN_NAV) ?? activeEntry(pathname, STUDENT_NAV) ?? STUDENT_NAV[0]!;

  function toggleNotif() {
    setNotifOpen((open) => {
      if (!open && unread > 0) {
        setUnread(0);
        void api.post('/api/me/notifications/read').catch(() => undefined);
      }
      return !open;
    });
  }

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <Link href={isAdmin ? '/admin' : '/app'} className={styles.brand}>
          <div className={styles.mark} aria-hidden>
            M
          </div>
          <div className={styles.brandName}>MockMint</div>
        </Link>

        <nav className={styles.nav} aria-label="Primary">
          <div className={styles.navGroup}>Student</div>
          {STUDENT_NAV.map((entry) => (
            <Link
              key={entry.href}
              href={entry.href}
              className={styles.navItem}
              data-active={current.href === entry.href}
            >
              <span className={styles.navIcon} aria-hidden>
                {entry.icon}
              </span>
              {entry.label}
              {entry.href === '/app/bookmarks' && bookmarkCount > 0 ? (
                <span className={styles.navBadge}>{bookmarkCount}</span>
              ) : null}
            </Link>
          ))}

          {isAdmin ? (
            <>
              <div className={`${styles.navGroup} ${styles.navGroupSpaced}`}>Admin</div>
              {ADMIN_NAV.map((entry) => (
                <Link
                  key={entry.href}
                  href={entry.href}
                  className={styles.navItem}
                  data-active={current.href === entry.href}
                >
                  <span className={styles.navIcon} aria-hidden>
                    {entry.icon}
                  </span>
                  {entry.label}
                </Link>
              ))}
            </>
          ) : null}
        </nav>

        <div className={styles.sidebarFooter}>
          <button type="button" className={styles.themeToggle} onClick={theme.toggle}>
            <span aria-hidden>{theme.icon}</span> {theme.label}
          </button>

          <div className={styles.account}>
            <div className={styles.avatar} aria-hidden>
              {user?.initials ?? '··'}
            </div>
            <div className={styles.accountText}>
              <div className={styles.accountName}>{user?.name ?? 'Loading…'}</div>
              <div className={styles.accountRole}>
                {isAdmin ? 'Administrator' : 'Aspirant · CAT 2026'}
              </div>
            </div>
            <button
              type="button"
              className={styles.logout}
              title="Log out"
              aria-label="Log out"
              onClick={() => void signOut()}
            >
              ⏻
            </button>
          </div>
        </div>
      </aside>

      <main className={styles.main}>
        <header className={styles.header}>
          <div>
            <div className={styles.pageTitle}>{current.title}</div>
            <div className={styles.pageSub}>{current.sub}</div>
          </div>

          <div className={styles.headerRight}>
            {onSearchChange ? (
              <div className={styles.search}>
                <span className={styles.searchIcon} aria-hidden>
                  ⌕
                </span>
                <input
                  className={styles.searchInput}
                  value={search ?? ''}
                  onChange={(e) => onSearchChange(e.target.value)}
                  placeholder="Search papers, results…"
                  aria-label="Search"
                />
              </div>
            ) : null}

            <button
              type="button"
              className={styles.bell}
              onClick={toggleNotif}
              aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
              aria-expanded={notifOpen}
            >
              ◔{unread > 0 ? <span className={styles.bellDot} /> : null}
            </button>
          </div>
        </header>

        {notifOpen ? (
          <div className={styles.notifPanel}>
            <div className={styles.notifHead}>
              Notifications
              <button
                type="button"
                className={styles.notifClose}
                onClick={() => setNotifOpen(false)}
                aria-label="Close notifications"
              >
                ✕
              </button>
            </div>
            {notifications.length === 0 ? (
              <div className={styles.notifEmpty}>Nothing here yet.</div>
            ) : (
              notifications.map((item) => (
                <div key={item.id} className={styles.notifRow}>
                  <div
                    className={styles.notifDot}
                    style={{ background: DOT_BY_KIND[item.kind] ?? 'var(--ink3)' }}
                  />
                  <div>
                    <div className={styles.notifBody}>{item.body}</div>
                    <div className={styles.notifWhen}>{item.when}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        ) : null}

        <div className={styles.content}>{children}</div>
      </main>
    </div>
  );
}
