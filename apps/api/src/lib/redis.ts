/**
 * Redis is used for the refresh-token allowlist and live attempt state.
 *
 * It is treated as a cache, never as the source of truth: `refresh_tokens` in Postgres
 * is authoritative for revocation, and attempt state is flushed to Postgres on every
 * answer. If Redis is unreachable the API degrades to Postgres-only rather than failing
 * requests — the dev experience shouldn't require a second container.
 */
import Redis from 'ioredis';
import { config } from '../config.js';

let client: Redis | null = null;
let disabled = false;

export function redis(): Redis | null {
  if (disabled) return null;
  if (client) return client;

  client = new Redis(config.redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: (times) => (times > 3 ? null : Math.min(times * 200, 1000)),
  });

  client.on('error', (err: NodeJS.ErrnoException) => {
    if (!disabled) {
      disabled = true;
      console.warn(`⚠ Redis unavailable (${err.message}) — continuing without cache`);
      client?.disconnect();
      client = null;
    }
  });

  client.connect().catch(() => {
    /* handled by the error listener above */
  });

  return client;
}

export async function cacheSet(key: string, value: string, ttlSeconds: number): Promise<void> {
  try {
    await redis()?.set(key, value, 'EX', ttlSeconds);
  } catch {
    /* cache is best-effort */
  }
}

export async function cacheGet(key: string): Promise<string | null> {
  try {
    return (await redis()?.get(key)) ?? null;
  } catch {
    return null;
  }
}

export async function cacheDel(key: string): Promise<void> {
  try {
    await redis()?.del(key);
  } catch {
    /* best-effort */
  }
}

export async function closeRedis(): Promise<void> {
  await client?.quit().catch(() => undefined);
  client = null;
}
