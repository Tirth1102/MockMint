import { initialsOf, type Role, type User } from '@mockmint/shared';

export interface UserRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  photo_url: string | null;
  target_percentile: number | null;
  created_at: Date | string;
}

export const USER_COLUMNS = `id, name, email, role, photo_url, target_percentile, created_at`;

export function toUser(row: UserRow): User {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    photoUrl: row.photo_url,
    initials: initialsOf(row.name),
    targetPercentile: row.target_percentile,
    createdAt: new Date(row.created_at).toISOString(),
  };
}
