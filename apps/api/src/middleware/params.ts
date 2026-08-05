import type { NextFunction, Request, Response, Router } from 'express';
import { badRequest } from '../lib/errors.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Rejects a malformed id before it reaches Postgres.
 *
 * Without this a junk path segment reaches the driver and surfaces as
 * `invalid input syntax for type uuid` — a 500 for what is plainly a client error.
 */
export function requireUuidParams(...names: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    for (const name of names) {
      const value = req.params[name];
      if (typeof value !== 'string' || !UUID_RE.test(value)) {
        next(badRequest(`${name} must be a valid id.`));
        return;
      }
    }
    next();
  };
}

export const requireIdParam = requireUuidParams('id');

/**
 * Registers the same check as a `router.param` hook, so every route on the router that
 * carries one of these placeholders is covered without repeating the middleware.
 */
export function guardUuidParams(router: Router, ...names: string[]): void {
  for (const name of names) {
    router.param(name, (_req: Request, _res: Response, next: NextFunction, value: unknown) => {
      if (typeof value !== 'string' || !UUID_RE.test(value)) {
        next(badRequest(`${name} must be a valid id.`));
        return;
      }
      next();
    });
  }
}
