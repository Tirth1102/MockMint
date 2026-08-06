import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// Repo root holds the single .env shared by api and web.
loadEnv({ path: path.resolve(here, '../../../.env') });
loadEnv();

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const isProd = process.env.NODE_ENV === 'production';

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  isProd,
  port: Number(process.env.PORT ?? process.env.API_PORT ?? 4000),

  databaseUrl: required('DATABASE_URL', 'postgres://mockmint:mockmint@localhost:5432/mockmint'),
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',

  jwt: {
    accessSecret: required('JWT_ACCESS_SECRET', isProd ? undefined : 'dev-access-secret-change-me'),
    refreshSecret: required(
      'JWT_REFRESH_SECRET',
      isProd ? undefined : 'dev-refresh-secret-change-me',
    ),
    accessTtl: process.env.ACCESS_TOKEN_TTL ?? '15m',
    refreshTtlDays: Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 30),
  },

  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:3000',
  cookieSecure: (process.env.COOKIE_SECURE ?? 'false') === 'true',

  seed: {
    adminEmail: process.env.SEED_ADMIN_EMAIL ?? 'admin@mockmint.in',
    adminPassword: process.env.SEED_ADMIN_PASSWORD ?? 'MockMint@2026',
    studentEmail: process.env.SEED_STUDENT_EMAIL ?? 'aarav@example.com',
    studentPassword: process.env.SEED_STUDENT_PASSWORD ?? 'demo1234',
  },
} as const;

export const REFRESH_COOKIE = 'mm_refresh';
