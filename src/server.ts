import { buildApp } from './app.js';
import { env } from './config/env.js';
import { pool } from './db/client.js';
import { logger } from './logger.js';

const app = buildApp();

const server = await new Promise<ReturnType<typeof app.listen>>((resolve, reject) => {
  const listening = app.listen(env.PORT, env.HOST, () => resolve(listening));
  listening.once('error', reject);
}).catch(async (error: unknown) => {
  logger.error(error, 'Failed to start Flava API');
  await pool.end();
  process.exit(1);
});
logger.info(`Server listening at http://${env.HOST}:${env.PORT}`);

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Shutting down Flava API');
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
  process.exit(0);
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
