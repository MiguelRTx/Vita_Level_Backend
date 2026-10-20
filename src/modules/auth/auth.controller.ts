import type { RequestHandler } from 'express';
import { getIdentity } from './auth.middleware.ts';
import type { AuthService } from './auth.service.ts';
import { loginSchema, registerSchema } from './auth.validation.ts';

export function createAuthController(service: AuthService): Record<'register' | 'login' | 'logout', RequestHandler> {
  return {
    register: async (request, response) => {
      response.status(201).json({ data: await service.register(registerSchema.parse(request.body)) });
    },
    login: async (request, response) => {
      response.json({ data: await service.login(loginSchema.parse(request.body)) });
    },
    logout: async (_request, response) => {
      await service.logout(getIdentity(response));
      response.sendStatus(204);
    },
  };
}
