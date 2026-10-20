import { Router } from 'express';
import type { PrismaClient } from '../../generated/prisma/client.ts';
import { createUsersController } from './users.controller.ts';
import { createUsersRepository } from './users.repository.ts';
import { createUsersService } from './users.service.ts';

export function createUsersRouter(database: PrismaClient, clock = () => new Date()) {
  const router = Router();
  const controller = createUsersController(createUsersService(createUsersRepository(database), clock));
  router.get('/', controller.get);
  router.patch('/', controller.update);
  return router;
}
