import { Router } from 'express';
import type { AuthEnvironment } from './config/env.ts';
import type { PrismaClient } from './generated/prisma/client.ts';
import { createAuthRepository } from './modules/auth/auth.repository.ts';
import { createAuthService } from './modules/auth/auth.service.ts';
import { createAuthRouter } from './modules/auth/auth.routes.ts';
import { requireAuth } from './modules/auth/auth.middleware.ts';
import { createUsersRouter } from './modules/users/users.routes.ts';
import { createCatalogRouter } from './modules/catalog/catalog.routes.ts';
import { createActivitiesRouter } from './modules/activities/activities.routes.ts';
import { createProgressRouter } from './modules/progress/progress.routes.ts';
import { createProjectsRouter } from './modules/projects/projects.routes.ts';
import { createStatisticsRouter } from './modules/statistics/statistics.routes.ts';

export function createApiRouter(database: PrismaClient, config: AuthEnvironment, defaultTimeZone: string, xpPerCompletion = 20, clock = () => new Date()) {
  const router = Router();
  const auth = createAuthService(createAuthRepository(database), config, defaultTimeZone);
  router.use('/auth', createAuthRouter(auth));
  router.use(requireAuth(auth));
  router.use('/me', createUsersRouter(database, clock));
  router.use(createCatalogRouter(database));
  router.use(createActivitiesRouter(database, xpPerCompletion, clock));
  router.use(createProgressRouter(database, clock));
  router.use(createProjectsRouter(database, clock));
  router.use(createStatisticsRouter(database, clock));
  return router;
}
