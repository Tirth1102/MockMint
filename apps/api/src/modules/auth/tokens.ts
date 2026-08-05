/**
 * Access + refresh token handling.
 *
 * Access: short-lived JWT (15 min), sent as `Authorization: Bearer`.
 * Refresh: opaque random string, hashed before storage, rotated on every use, and
 * held in an httpOnly cookie. Both Postgres (`refresh_tokens`) and a Redis allowlist
 * record it, so `logout` genuinely revokes rather than merely clearing a cookie.
 */
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Role } from '@mockmint/shared';
import { config } from '../../config.js';
import { query, queryOne } from '../../db/pool.js';
import { cacheDel, cacheSet, cacheGet } from '../../lib/redis.js';
import { unauthorized } from '../../lib/errors.js';

export interface AccessClaims {
  sub: string;
  role: Role;
}

const ALLOWLIST_PREFIX = 'refresh:';

export function signAccessToken(userId: string, role: Role): { token: string; expiresIn: number } {
  const token = jwt.sign({ sub: userId, role } satisfies AccessClaims, config.jwt.accessSecret, {
    expiresIn: config.jwt.accessTtl as jwt.SignOptions['expiresIn'],
  });
  const decoded = jwt.decode(token) as { exp?: number; iat?: number } | null;
  const expiresIn = decoded?.exp && decoded.iat ? decoded.exp - decoded.iat : 900;
  return { token, expiresIn };
}

export function verifyAccessToken(token: string): AccessClaims {
  try {
    const claims = jwt.verify(token, config.jwt.accessSecret) as AccessClaims;
    if (!claims.sub) throw new Error('missing subject');
    return claims;
  } catch {
    throw unauthorized('Your session has expired. Sign in again.');
  }
}

function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/** Issues a fresh refresh token and records it in both stores. */
export async function issueRefreshToken(userId: string): Promise<string> {
  const raw = crypto.randomBytes(48).toString('base64url');
  const digest = hashToken(raw);
  const ttlSeconds = config.jwt.refreshTtlDays * 24 * 60 * 60;

  await query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, now() + ($3 || ' days')::interval)`,
    [userId, digest, config.jwt.refreshTtlDays],
  );
  await cacheSet(`${ALLOWLIST_PREFIX}${digest}`, userId, ttlSeconds);

  return raw;
}

/**
 * Validates a refresh token and rotates it: the presented token is revoked and a new
 * one issued. Reuse of an already-revoked token yields 401 rather than a new session.
 */
export async function rotateRefreshToken(
  raw: string,
): Promise<{ userId: string; role: Role; refreshToken: string }> {
  const digest = hashToken(raw);

  const cached = await cacheGet(`${ALLOWLIST_PREFIX}${digest}`);
  const row = await queryOne<{ id: string; user_id: string; role: Role }>(
    `SELECT rt.id, rt.user_id, u.role
       FROM refresh_tokens rt
       JOIN users u ON u.id = rt.user_id
      WHERE rt.token_hash = $1
        AND rt.revoked_at IS NULL
        AND rt.expires_at > now()
        AND u.blocked_at IS NULL`,
    [digest],
  );

  if (!row || (cached && cached !== row.user_id)) {
    await cacheDel(`${ALLOWLIST_PREFIX}${digest}`);
    throw unauthorized('Your session has expired. Sign in again.');
  }

  await query(`UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1`, [row.id]);
  await cacheDel(`${ALLOWLIST_PREFIX}${digest}`);

  const refreshToken = await issueRefreshToken(row.user_id);
  return { userId: row.user_id, role: row.role, refreshToken };
}

export async function revokeRefreshToken(raw: string): Promise<void> {
  const digest = hashToken(raw);
  await query(`UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1`, [digest]);
  await cacheDel(`${ALLOWLIST_PREFIX}${digest}`);
}

export async function revokeAllForUser(userId: string): Promise<void> {
  const rows = await query<{ token_hash: string }>(
    `UPDATE refresh_tokens SET revoked_at = now()
      WHERE user_id = $1 AND revoked_at IS NULL
      RETURNING token_hash`,
    [userId],
  );
  await Promise.all(rows.rows.map((r) => cacheDel(`${ALLOWLIST_PREFIX}${r.token_hash}`)));
}
