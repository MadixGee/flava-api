import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { env } from './config/env.js';
import { registerHealthRoutes } from './routes/health.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: env.NODE_ENV === 'production' ? 'info' : 'debug' },
    trustProxy: env.NODE_ENV === 'production',
    bodyLimit: 1_048_576,
  });

  await app.register(helmet);
  await app.register(cors, {
    origin: env.CORS_ORIGIN.split(',').map((origin) => origin.trim()),
    credentials: true,
  });

  app.get('/', async () => ({
    name: 'Flava API',
    version: '0.1.0',
    docs: 'API documentation will be added with the first feature module.',
  }));

  await registerHealthRoutes(app);

  app.setNotFoundHandler((_request, reply) => {
    return reply.code(404).send({ error: 'Not found' });
  });

  app.setErrorHandler((error, _request, reply) => {
    app.log.error({ err: error }, 'Unhandled request error');
    const statusCode = error.statusCode && error.statusCode >= 400 && error.statusCode < 500
      ? error.statusCode
      : 500;
    return reply.code(statusCode).send({
      error: statusCode === 500 ? 'Internal server error' : error.message,
    });
  });

  return app;
}
