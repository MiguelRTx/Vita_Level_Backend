import { Router } from 'express';
import { createAuthController } from './auth.controller.ts';
import { requireAuth } from './auth.middleware.ts';
import type { AuthService } from './auth.service.ts';
import { accountLoginLimit, requestLimit } from '../../shared/middleware/rate-limits.ts';

export function createAuthRouter(service: AuthService) {
  const router = Router();
  const controller = createAuthController(service);
  router.post('/register', requestLimit(10, 60 * 60 * 1000), controller.register);
  router.post('/login', requestLimit(20, 15 * 60 * 1000, true), accountLoginLimit(), controller.login);
  router.post('/logout', requireAuth(service), controller.logout);
  return router;
}
