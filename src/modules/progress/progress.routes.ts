import { Router } from 'express';
import { z } from 'zod';
import type { PrismaClient } from '../../generated/prisma/client.ts';
import { idSchema, paginationSchema, quantitySchema } from '../../shared/domain.ts';
import { getIdentity } from '../auth/auth.middleware.ts';
import { createProgressService } from './progress.service.ts';

export function createProgressRouter(database: PrismaClient, clock: () => Date) {
  const router = Router();
  const service = createProgressService(database, clock);
  router.get('/occurrence-units/:id/progress', async (req, res) => {
    res.json(await service.list(getIdentity(res).userId, idSchema.parse(req.params.id), paginationSchema.parse(req.query)));
  });
  router.post('/occurrence-units/:id/progress', async (req, res) => {
    const { amount } = z.strictObject({ amount: quantitySchema }).parse(req.body);
    const result = await service.record(getIdentity(res).userId, idSchema.parse(req.params.id), amount, idSchema.parse(req.get('Idempotency-Key')));
    res.status(result.replayed ? 200 : 201).set('Idempotency-Replayed', String(result.replayed)).json(result.body);
  });
  return router;
}
