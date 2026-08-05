import type { NextFunction, Request, Response } from 'express';
import type { Role } from '@mockmint/shared';
import { forbidden, unauthorized } from '../lib/errors.js';
import { verifyAccessToken } from '../modules/auth/tokens.js';
import { queryOne } from '../db/pool.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: { id: string; role: Role };
    }
  }
}

/** Requires a valid access token. Populates `req.user`. */
export async function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw unauthorized();

    const claims = verifyAccessToken(header.slice(7));

    // A user blocked mid-session must lose access before their access token expires.
    const row = await queryOne<{ role: Role; blocked_at: string | null }>(
      `SELECT role, blocked_at FROM users WHERE id = $1`,
      [claims.sub],
    );
    if (!row) throw unauthorized('Account no longer exists.');
    if (row.blocked_at) throw forbidden('This account has been blocked.');

    req.user = { id: claims.sub, role: row.role };
    next();
  } catch (err) {
    next(err);
  }
}

/** Requires `role = admin`. Must run after `requireAuth`. */
export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) return next(unauthorized());
  if (req.user.role !== 'admin') return next(forbidden('Administrator access required.'));
  next();
}

export function currentUser(req: Request): { id: string; role: Role } {
  if (!req.user) throw unauthorized();
  return req.user;
}
