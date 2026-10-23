import cors from 'cors';
import express, { type ErrorRequestHandler, type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { env } from './config/env.js';
import { flavaLogoSvg, openApiDocument } from './docs/openapi.js';
import { logger } from './logger.js';
import { createAuthRouter } from './routes/auth.js';
import { createHealthRouter } from './routes/health.js';

export function buildApp(): Express {
  const app = express();
  const isProduction = env.NODE_ENV === 'production';

  app.disable('x-powered-by');
  if (isProduction) app.set('trust proxy', true);

  app.use(pinoHttp({ logger }));
  // Over plain HTTP on a non-localhost origin, browsers ignore COOP and upgrade-insecure-requests/HSTS break asset loading.
  app.use(helmet(isProduction ? {} : {
    crossOriginOpenerPolicy: false,
    originAgentCluster: false,
    strictTransportSecurity: false,
    contentSecurityPolicy: {
      directives: { upgradeInsecureRequests: null },
    },
  }));
  app.use(cors({
    origin: env.CORS_ORIGIN.split(',').map((origin) => origin.trim()),
    credentials: true,
  }));
  app.use(express.json({ limit: '1mb' }));

  app.get('/', (_request, reply) => {
    reply.json({
      name: 'Flava API',
      version: '0.1.0',
      docs: '/docs',
    });
  });

  app.get('/docs/json', (_request, reply) => {
    reply.json(openApiDocument);
  });
  app.get('/docs/favicon.svg', (_request, reply) => {
    reply.type('image/svg+xml').send(flavaLogoSvg);
  });
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiDocument, {
    customSiteTitle: 'Flava API Docs',
    customfavIcon: '/docs/favicon.svg',
  }));

  app.use(createHealthRouter());
  app.use(createAuthRouter());

  app.use((_request, reply) => {
    reply.status(404).json({ error: 'Not found' });
  });

  const errorHandler: ErrorRequestHandler = (error: Error & { statusCode?: number; type?: string }, request, reply, next) => {
    if (reply.headersSent) {
      next(error);
      return;
    }
    request.log.error({ err: error }, 'Unhandled request error');
    const statusCode = error.statusCode && error.statusCode >= 400 && error.statusCode < 500
      ? error.statusCode
      : 500;
    let message = error.message;
    if (error.type === 'entity.parse.failed') message = 'Invalid request body';
    reply.status(statusCode).json({
      error: statusCode === 500 ? 'Internal server error' : message,
    });
  };
  app.use(errorHandler);

  return app;
}
