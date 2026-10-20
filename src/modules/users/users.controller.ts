import type { RequestHandler } from 'express';
import { z } from 'zod';
import { timeZoneSchema } from '../../config/env.ts';
import { getIdentity } from '../auth/auth.middleware.ts';
import type { createUsersService } from './users.service.ts';

const profilePatchSchema = z.strictObject({
  displayName: z.string().trim().min(1).max(80).optional(), timeZone: timeZoneSchema.optional(),
}).refine((value) => Object.keys(value).length > 0, 'At least one field is required');

export function createUsersController(service: ReturnType<typeof createUsersService>): Record<'get' | 'update', RequestHandler> {
  return {
    get: async (_request, response) => response.json({ data: await service.getProfile(getIdentity(response).userId) }),
    update: async (request, response) => response.json({ data: await service.updateProfile(
      getIdentity(response).userId, profilePatchSchema.parse(request.body),
    ) }),
  };
}
