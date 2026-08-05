import { hash, verify, Algorithm } from '@node-rs/argon2';

/**
 * Argon2id parameters (ARCHITECTURE.md §6). 19 MiB / t=2 / p=1 is the OWASP
 * baseline — comfortable on a small API node while staying costly to attack.
 */
export const ARGON_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, ARGON_OPTIONS);
}

export async function verifyPassword(digest: string, plain: string): Promise<boolean> {
  try {
    return await verify(digest, plain, ARGON_OPTIONS);
  } catch {
    // A malformed stored hash must read as "wrong password", never as a 500.
    return false;
  }
}
