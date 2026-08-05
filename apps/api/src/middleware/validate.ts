import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import { badRequest } from '../lib/errors.js';

type Source = 'body' | 'query' | 'params';

/**
 * Parses one part of the request with a Zod schema, replacing it with the parsed
 * value so handlers see coerced, trusted data.
 */
export function validate<S extends ZodTypeAny>(schema: S, source: Source = 'body') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const parsed = schema.parse(req[source]);
      // req.query is a getter in Express 5; assigning to a local field keeps both working.
      Object.defineProperty(req, source, { value: parsed, writable: true, configurable: true });
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const first = err.issues[0];
        next(
          badRequest(
            first ? `${first.path.join('.') || 'body'}: ${first.message}` : 'Invalid request',
            err.issues,
          ),
        );
        return;
      }
      next(err);
    }
  };
}

export type Infer<S extends ZodTypeAny> = z.infer<S>;
