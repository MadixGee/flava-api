import { Router } from 'express';
import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { logger } from '../logger.js';

export function createHealthRouter(): Router {
  const router = Router();

  router.get('/health/live', (_request, reply) => {
    reply.json({ status: 'ok' });
  });

  router.get('/health/ready', async (_request, reply) => {
    try {
      await db.execute(sql`select 1`);
      reply.json({ status: 'ok', dependencies: { database: 'ok' } });
    } catch (error) {
      logger.error({ err: error }, 'Readiness check failed');
      reply.status(503).json({
        status: 'error',
        dependencies: { database: 'unavailable' },
      });
    }
  });

  return router;
}
