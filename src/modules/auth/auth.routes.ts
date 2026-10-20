import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { createAuthController } from './auth.controller.ts';
import { requireAuth } from './auth.middleware.ts';
import type { AuthService } from './auth.service.ts';

export function createAuthRouter(service: AuthService) {
  const router = Router();
  const controller = createAuthController(service);
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false,
    handler: (_request, response) => response.status(429).json({
      error: { code: 'RATE_LIMITED', message: 'Too many attempts. Try again later.', requestId: response.locals.requestId },
    }),
  });
  router.post('/register', limiter, controller.register);
  router.post('/login', limiter, controller.login);
  router.post('/logout', requireAuth(service), controller.logout);
  return router;
}
