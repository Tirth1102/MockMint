'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import ui from './ui/ui.module.css';

/**
 * Client-side gate for the authenticated shell. The API enforces authorisation on every
 * request regardless — this only keeps the UI from flashing a page the user cannot load.
 */
export function RequireAuth({
  children,
  adminOnly = false,
}: {
  children: React.ReactNode;
  adminOnly?: boolean;
}) {
  const { user, loading, isAdmin } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace('/auth/login');
    else if (adminOnly && !isAdmin) router.replace('/app');
  }, [loading, user, isAdmin, adminOnly, router]);

  if (loading) return <div className={ui.loading}>Restoring your session…</div>;
  if (!user || (adminOnly && !isAdmin)) return null;

  return <>{children}</>;
}
