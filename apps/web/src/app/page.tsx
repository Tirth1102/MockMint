'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import ui from '@/components/ui/ui.module.css';

/** Entry point: send signed-in users to their shell, everyone else to login. */
export default function RootPage() {
  const { user, loading, isAdmin } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace('/auth/login');
    else router.replace(isAdmin ? '/admin' : '/app');
  }, [user, loading, isAdmin, router]);

  return <div className={ui.loading}>Loading MockMint…</div>;
}
