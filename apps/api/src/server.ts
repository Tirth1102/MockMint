import { config } from './config.js';
import { createApp } from './app.js';
import { closePool } from './db/pool.js';
import { closeRedis } from './lib/redis.js';

const app = createApp();

const server = app.listen(config.port, () => {
  console.log(`MockMint API listening on http://localhost:${config.port} (${config.env})`);
  console.log(`CORS origin: ${config.webOrigin}`);
});

async function shutdown(signal: string): Promise<void> {
  console.log(`\n${signal} received — shutting down`);
  server.close(async () => {
    await Promise.allSettled([closePool(), closeRedis()]);
    process.exit(0);
  });
  // Don't let an open keep-alive socket hold the process forever.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
