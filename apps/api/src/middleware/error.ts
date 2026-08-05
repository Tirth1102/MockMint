import type { NextFunction, Request, Response } from 'express';
import type { ApiError } from '@mockmint/shared';
import { config } from '../config.js';
import { HttpError } from '../lib/errors.js';

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: 'not_found',
    message: `No route for ${req.method} ${req.path}`,
  } satisfies ApiError);
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({
      error: err.code,
      message: err.message,
      ...(err.details === undefined ? {} : { details: err.details }),
    } satisfies ApiError);
    return;
  }

  // Postgres unique-violation surfaces as a conflict rather than a 500.
  if (typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505') {
    res.status(409).json({
      error: 'conflict',
      message: 'That record already exists.',
    } satisfies ApiError);
    return;
  }

  console.error('[unhandled]', err);
  res.status(500).json({
    error: 'internal_error',
    message: 'Something went wrong on our end.',
    ...(config.isProd ? {} : { details: (err as Error)?.stack }),
  } satisfies ApiError);
}

/** Wraps an async handler so rejected promises reach the error middleware. */
export function asyncHandler<T extends (req: Request, res: Response) => Promise<unknown>>(fn: T) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res).catch(next);
  };
}
