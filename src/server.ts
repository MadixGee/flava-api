import { buildApp } from './app.js';
import { env } from './config/env.js';
import { pool } from './db/client.js';

const app = await buildApp();

try {
  await app.listen({ port: env.PORT, host: env.HOST });
} catch (error) {
  app.log.error(error, 'Failed to start Flava API');
  await pool.end();
  process.exit(1);
}

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'Shutting down Flava API');
  await app.close();
  await pool.end();
  process.exit(0);
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
