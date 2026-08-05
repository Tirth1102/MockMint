'use client';

import { RequireAuth } from '@/components/RequireAuth';

/** Every /admin route needs `role = admin`; the API enforces the same on each request. */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <RequireAuth adminOnly>{children}</RequireAuth>;
}
