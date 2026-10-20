import { randomUUID } from 'node:crypto';
import cors from 'cors';
import express from 'express';
import type { Router } from 'express';
import helmet from 'helmet';
import { createHealthRouter } from './modules/health/health.routes.ts';
import type { HealthRepository } from './modules/health/health.repository.ts';
import { AppError } from './shared/errors/app-error.ts';
import { errorHandler, notFound } from './shared/middleware/error-handler.ts';

export interface AppDependencies {
  healthRepository: HealthRepository;
  corsOrigins: readonly string[];
  apiRouter?: Router;
}

export function createApp({ healthRepository, corsOrigins, apiRouter }: AppDependencies) {
  const app = express();
  app.disable('x-powered-by');
  app.use((_request, response, next) => {
    const requestId = randomUUID();
    response.locals.requestId = requestId;
    response.setHeader('X-Request-Id', requestId);
    response.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(helmet());
  app.use(cors({
    origin(origin, callback) {
      if (!origin || corsOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new AppError(403, 'ORIGIN_NOT_ALLOWED', 'Origin is not allowed'));
      }
    },
    credentials: false,
    methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
    exposedHeaders: ['X-Request-Id', 'Idempotency-Replayed'],
  }));
  app.use(express.json({ limit: '32kb' }));
  app.get('/live', (_request, response) => {
    response.json({ data: { status: 'alive' } });
  });
  app.use('/health', createHealthRouter(healthRepository));
  if (apiRouter) app.use('/api/v1', apiRouter);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
