import type { RequestHandler, Response } from 'express';
import { AppError } from '../../shared/errors/app-error.ts';
import type { AuthService, Identity } from './auth.service.ts';

export function requireAuth(service: AuthService): RequestHandler {
  return async (request, response, next) => {
    const header = request.headers.authorization;
    if (!header || !/^Bearer \S+$/i.test(header)) {
      throw new AppError(401, 'AUTH_REQUIRED', 'Sign in to continue');
    }
    response.locals.identity = await service.authenticate(header.slice(7));
    next();
  };
}

export function getIdentity(response: Response): Identity {
  return response.locals.identity as Identity;
}
