'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { SearchContext } from '@/lib/search';
import { RequireAuth } from '@/components/RequireAuth';
import { Shell } from '@/components/shell/Shell';

/**
 * Authenticated shell shared by the student app and the admin panel. The exam runner
 * deliberately sits outside this group — it takes over the full viewport.
 */
export default function ShellLayout({ children }: { children: React.ReactNode }) {
  const [query, setQuery] = useState('');
  const [bookmarkCount, setBookmarkCount] = useState(0);
  const { user } = useAuth();
  const pathname = usePathname();

  // Refresh the sidebar badge whenever the route changes — bookmarking happens on
  // several screens and the count should not go stale behind the user.
  useEffect(() => {
    if (!user) return;
    api
      .get<{ items: unknown[] }>('/api/me/bookmarks')
      .then((data) => setBookmarkCount(data.items.length))
      .catch(() => undefined);
  }, [user, pathname]);

  const search = useMemo(() => ({ query, setQuery }), [query]);

  return (
    <RequireAuth>
      <SearchContext.Provider value={search}>
        <Shell search={query} onSearchChange={setQuery} bookmarkCount={bookmarkCount}>
          {children}
        </Shell>
      </SearchContext.Provider>
    </RequireAuth>
  );
}
