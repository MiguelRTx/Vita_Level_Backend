import { createHash } from 'node:crypto';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import type { Request, Response } from 'express';

function reject(_request: Request, response: Response) {
  response.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests. Try again later.', requestId: response.locals.requestId } });
}

export function requestLimit(limit: number, windowMs: number, skipSuccessfulRequests = false) {
  return rateLimit({ limit, windowMs, standardHeaders: 'draft-8', legacyHeaders: false, skipSuccessfulRequests, skip: (request) => request.method === 'OPTIONS', handler: reject });
}

export function accountLoginLimit() {
  return rateLimit({ limit: 10, windowMs: 15 * 60 * 1000, standardHeaders: 'draft-8', legacyHeaders: false, skipSuccessfulRequests: true,
    keyGenerator: (request) => typeof request.body?.email === 'string'
      ? createHash('sha256').update(request.body.email.trim().toLowerCase()).digest('hex')
      : ipKeyGenerator(request.ip ?? '127.0.0.1'), handler: reject });
}

export function userWriteLimit(limit = 60) {
  return rateLimit({ limit, windowMs: 60000, standardHeaders: 'draft-8', legacyHeaders: false,
    keyGenerator: (request, response) => response.locals.identity?.userId ?? ipKeyGenerator(request.ip ?? '127.0.0.1'),
    skip: (request) => ['GET', 'HEAD', 'OPTIONS'].includes(request.method), handler: reject });
}
