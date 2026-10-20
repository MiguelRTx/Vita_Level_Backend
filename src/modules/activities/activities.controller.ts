import type { Request, Response } from 'express';
import { idSchema } from '../../shared/domain.ts';
import { getIdentity } from '../auth/auth.middleware.ts';
import type { createActivitiesService } from './activities.service.ts';
import { activityQuerySchema, createActivitySchema, editActivitySchema, occurrenceQuerySchema } from './activities.validation.ts';

export function createActivitiesController(service: ReturnType<typeof createActivitiesService>) {
  const owner = (response: Response) => getIdentity(response).userId;
  const id = (request: Request) => idSchema.parse(request.params.id);
  return {
    list: async (req: Request, res: Response) => { res.json(await service.list(owner(res), activityQuerySchema.parse(req.query))); },
    get: async (req: Request, res: Response) => { res.json({ data: await service.get(owner(res), id(req)) }); },
    create: async (req: Request, res: Response) => { res.status(201).json({ data: await service.create(owner(res), createActivitySchema.parse(req.body)) }); },
    edit: async (req: Request, res: Response) => { res.json({ data: await service.edit(owner(res), id(req), editActivitySchema.parse(req.body)) }); },
    archive: async (req: Request, res: Response) => { res.json({ data: await service.archive(owner(res), id(req)) }); },
    occurrences: async (req: Request, res: Response) => { res.json(await service.occurrences(owner(res), id(req), occurrenceQuerySchema.parse(req.query))); },
    occurrence: async (req: Request, res: Response) => { res.json({ data: await service.occurrence(owner(res), id(req)) }); },
  };
}
