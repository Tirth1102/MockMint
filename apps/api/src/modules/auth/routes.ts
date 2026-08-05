import crypto from 'node:crypto';
import { Router, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import type { AuthResponse } from '@mockmint/shared';
import { config, REFRESH_COOKIE } from '../../config.js';
import { queryOne, query } from '../../db/pool.js';
import { asyncHandler } from '../../middleware/error.js';
import { validate } from '../../middleware/validate.js';
import { requireAuth, currentUser } from '../../middleware/auth.js';
import { badRequest, unauthorized, conflict } from '../../lib/errors.js';
import { hashPassword, verifyPassword } from './password.js';
import {
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllForUser,
  signAccessToken,
} from './tokens.js';
import { toUser, USER_COLUMNS, type UserRow } from '../users/mapper.js';

export const authRouter = Router();

/** 5/min on the credential endpoints (ARCHITECTURE.md §6). */
const credentialLimiter = rateLimit({
  windowMs: 60_000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'too_many_requests', message: 'Too many attempts. Wait a minute and retry.' },
  skip: () => !config.isProd && process.env.DISABLE_RATE_LIMIT === 'true',
});

const emailSchema = z.string().trim().toLowerCase().email('Enter a valid email address.');

const registerSchema = z.object({
  name: z.string().trim().min(3, 'Tell us your name.').max(120),
  email: emailSchema,
  password: z.string().min(8, 'Use at least 8 characters.').max(200),
});

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password.').max(200),
});

function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: config.cookieSecure ? 'none' : 'lax',
    path: '/api/auth',
    maxAge: config.jwt.refreshTtlDays * 24 * 60 * 60 * 1000,
  });
}

function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
}

// ---------------------------------------------------------------- register

authRouter.post(
  '/register',
  credentialLimiter,
  validate(registerSchema),
  asyncHandler(async (req, res) => {
    const { name, email, password } = req.body as z.infer<typeof registerSchema>;

    const existing = await queryOne<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [
      email,
    ]);
    if (existing) throw conflict('An account with that email already exists.');

    const passwordHash = await hashPassword(password);
    const row = await queryOne<UserRow>(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1, $2, $3, 'student')
       RETURNING ${USER_COLUMNS}`,
      [name, email, passwordHash],
    );
    if (!row) throw badRequest('Could not create the account.');

    const refreshToken = await issueRefreshToken(row.id);
    setRefreshCookie(res, refreshToken);
    const { token, expiresIn } = signAccessToken(row.id, row.role);

    res.status(201).json({
      user: toUser(row),
      tokens: { accessToken: token, expiresIn },
    } satisfies AuthResponse);
  }),
);

// ---------------------------------------------------------------- login

authRouter.post(
  '/login',
  credentialLimiter,
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body as z.infer<typeof loginSchema>;

    const row = await queryOne<UserRow & { password_hash: string; blocked_at: string | null }>(
      `SELECT ${USER_COLUMNS}, password_hash, blocked_at FROM users WHERE email = $1`,
      [email],
    );

    // Same message for unknown email and wrong password — no user enumeration.
    const ok = row ? await verifyPassword(row.password_hash, password) : false;
    if (!row || !ok) throw unauthorized('Email or password is incorrect.');
    if (row.blocked_at) throw unauthorized('This account has been blocked.');

    const refreshToken = await issueRefreshToken(row.id);
    setRefreshCookie(res, refreshToken);
    const { token, expiresIn } = signAccessToken(row.id, row.role);

    res.json({
      user: toUser(row),
      tokens: { accessToken: token, expiresIn },
    } satisfies AuthResponse);
  }),
);

// ---------------------------------------------------------------- refresh

authRouter.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const raw = (req.cookies?.[REFRESH_COOKIE] as string | undefined) ?? req.body?.refreshToken;
    if (!raw) throw unauthorized('No refresh token supplied.');

    const { userId, role, refreshToken } = await rotateRefreshToken(raw);
    setRefreshCookie(res, refreshToken);

    const row = await queryOne<UserRow>(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [userId]);
    if (!row) throw unauthorized('Account no longer exists.');

    const { token, expiresIn } = signAccessToken(userId, role);
    res.json({ user: toUser(row), tokens: { accessToken: token, expiresIn } } satisfies AuthResponse);
  }),
);

// ---------------------------------------------------------------- logout

authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const raw = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    if (raw) await revokeRefreshToken(raw);
    clearRefreshCookie(res);
    res.status(204).end();
  }),
);

// ---------------------------------------------------------------- password reset

authRouter.post(
  '/forgot-password',
  credentialLimiter,
  validate(z.object({ email: emailSchema })),
  asyncHandler(async (req, res) => {
    const { email } = req.body as { email: string };
    const row = await queryOne<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [email]);

    if (row) {
      // Single-use, 30-minute token. Stored hashed alongside the refresh tokens.
      const raw = crypto.randomBytes(32).toString('base64url');
      const digest = crypto.createHash('sha256').update(raw).digest('hex');
      await query(
        `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
         VALUES ($1, $2, now() + interval '30 minutes')`,
        [row.id, `reset:${digest}`],
      );
      // Wiring this to the mail worker is the remaining step; logging keeps dev usable.
      if (!config.isProd) console.log(`· password reset token for ${email}: ${raw}`);
    }

    // 202 regardless, so the response cannot be used to test which emails exist.
    res.status(202).json({ message: 'If that account exists, a reset link is on its way.' });
  }),
);

authRouter.post(
  '/reset-password',
  credentialLimiter,
  validate(
    z.object({
      token: z.string().min(10),
      password: z.string().min(8, 'Use at least 8 characters.').max(200),
    }),
  ),
  asyncHandler(async (req, res) => {
    const { token, password } = req.body as { token: string; password: string };
    const digest = `reset:${crypto.createHash('sha256').update(token).digest('hex')}`;

    const row = await queryOne<{ id: string; user_id: string }>(
      `SELECT id, user_id FROM refresh_tokens
        WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()`,
      [digest],
    );
    if (!row) throw badRequest('That reset link is invalid or has expired.');

    await query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [
      await hashPassword(password),
      row.user_id,
    ]);
    await query(`UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1`, [row.id]);
    // A password change ends every other session.
    await revokeAllForUser(row.user_id);

    res.json({ message: 'Password updated. Sign in with your new password.' });
  }),
);

// ---------------------------------------------------------------- session probe

authRouter.get(
  '/session',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { id } = currentUser(req);
    const row = await queryOne<UserRow>(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [id]);
    if (!row) throw unauthorized();
    res.json({ user: toUser(row) });
  }),
);
