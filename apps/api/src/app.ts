import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { authRouter } from './modules/auth/routes.js';
import { papersRouter } from './modules/papers/routes.js';
import { attemptsRouter } from './modules/attempts/routes.js';
import { resultsRouter } from './modules/results/routes.js';
import { meRouter } from './modules/me/routes.js';
import { adminRouter } from './modules/admin/routes.js';
import { queryOne } from './db/pool.js';

export function createApp(): express.Express {
  const app = express();

  app.set('trust proxy', 1);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(
    cors({
      origin: config.webOrigin,
      // The refresh token lives in an httpOnly cookie, so the browser must send credentials.
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.get('/health', async (_req, res) => {
    try {
      await queryOne('SELECT 1 AS ok');
      res.json({ status: 'ok', env: config.env });
    } catch (err) {
      res.status(503).json({ status: 'degraded', message: (err as Error).message });
    }
  });

  app.use('/api/auth', authRouter);
  app.use('/api/me', meRouter);
  app.use('/api/papers', papersRouter);
  app.use('/api/attempts', attemptsRouter);
  app.use('/api/admin', adminRouter);
  // Serves /api/attempts/:id/result|review|suggestions plus /api/results and /api/leaderboard.
  app.use('/api', resultsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
