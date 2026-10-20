import { Router } from 'express';
import type { PrismaClient } from '../../generated/prisma/client.ts';
import { getIdentity } from '../auth/auth.middleware.ts';
import { createStatisticsService, dashboardQuerySchema, statisticsQuerySchema } from './statistics.service.ts';

export function createStatisticsRouter(database: PrismaClient, clock: () => Date) {
  const router = Router();
  const service = createStatisticsService(database, clock);
  router.get('/dashboard', async (req, res) => { res.json({ data: await service.dashboard(getIdentity(res).userId, dashboardQuerySchema.parse(req.query)) }); });
  for (const kind of ['completions', 'xp'] as const) {
    router.get(`/history/${kind}`, async (req, res) => { res.json(await service.history(getIdentity(res).userId, statisticsQuerySchema.parse(req.query), kind)); });
  }
  return router;
}
