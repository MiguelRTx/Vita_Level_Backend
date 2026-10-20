import type { RequestHandler } from 'express';
import type { createHealthService } from './health.service.ts';

export function createHealthController(service: ReturnType<typeof createHealthService>): RequestHandler {
  return async (_request, response) => {
    const data = await service.checkReadiness();
    response.setHeader('Cache-Control', 'no-store');
    response.status(200).json({ data });
  };
}
