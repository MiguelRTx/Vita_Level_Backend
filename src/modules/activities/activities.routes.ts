import { Router } from 'express';
import type { PrismaClient } from '../../generated/prisma/client.ts';
import { createActivitiesController } from './activities.controller.ts';
import { createActivitiesService } from './activities.service.ts';

export function createActivitiesRouter(database: PrismaClient, xp: number, clock: () => Date) {
  const router = Router();
  const controller = createActivitiesController(createActivitiesService(database, xp, clock));
  router.route('/activities').get(controller.list).post(controller.create);
  router.route('/activities/:id').get(controller.get).patch(controller.edit);
  router.post('/activities/:id/archive', controller.archive);
  router.get('/activities/:id/occurrences', controller.occurrences);
  router.get('/occurrences/:id', controller.occurrence);
  return router;
}
