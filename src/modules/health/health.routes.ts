import { Router } from 'express';
import { createHealthController } from './health.controller.ts';
import type { HealthRepository } from './health.repository.ts';
import { createHealthService } from './health.service.ts';

export function createHealthRouter(repository: HealthRepository): Router {
  const router = Router();
  router.get('/', createHealthController(createHealthService(repository)));
  return router;
}
