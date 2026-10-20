import { Router } from 'express';
import { z } from 'zod';
import type { PrismaClient } from '../../generated/prisma/client.ts';
import { idSchema, paginationSchema } from '../../shared/domain.ts';
import { getIdentity } from '../auth/auth.middleware.ts';
import { createProjectsService, projectCreateSchema, projectEditSchema } from './projects.service.ts';

export function createProjectsRouter(database: PrismaClient, clock: () => Date) {
  const router = Router();
  const service = createProjectsService(database, clock);
  router.get('/projects', async (req, res) => { res.json(await service.list(getIdentity(res).userId, paginationSchema.extend({ archived: z.enum(['true', 'false']).default('false') }).parse(req.query))); });
  router.post('/projects', async (req, res) => { res.status(201).json({ data: await service.create(getIdentity(res).userId, projectCreateSchema.parse(req.body)) }); });
  router.get('/projects/:id', async (req, res) => { res.json({ data: await service.get(getIdentity(res).userId, idSchema.parse(req.params.id)) }); });
  router.patch('/projects/:id', async (req, res) => { res.json({ data: await service.edit(getIdentity(res).userId, idSchema.parse(req.params.id), projectEditSchema.parse(req.body)) }); });
  router.post('/projects/:id/archive', async (req, res) => { res.json({ data: await service.archive(getIdentity(res).userId, idSchema.parse(req.params.id)) }); });
  router.get('/projects/:id/tasks', async (req, res) => { res.json(await service.tasks(getIdentity(res).userId, idSchema.parse(req.params.id), paginationSchema.parse(req.query))); });
  return router;
}
