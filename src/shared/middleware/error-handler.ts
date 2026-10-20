import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../errors/app-error.ts';

export const notFound: RequestHandler = (_request, _response, next) => {
  next(new AppError(404, 'NOT_FOUND', 'Resource not found'));
};

export const errorHandler: ErrorRequestHandler = (error: unknown, _request, response, next) => {
  if (response.headersSent) {
    next(error);
    return;
  }

  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'An unexpected error occurred';
  let details: unknown;

  if (error instanceof AppError) {
    ({ status, code, message, details } = error);
  } else if (error instanceof ZodError) {
    status = 422;
    code = 'VALIDATION_ERROR';
    message = 'Invalid request data';
    details = error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
  } else if (typeof error === 'object' && error !== null && 'type' in error) {
    if (error.type === 'entity.parse.failed') {
      status = 400;
      code = 'INVALID_JSON';
      message = 'Request body is not valid JSON';
    } else if (error.type === 'entity.too.large') {
      status = 413;
      code = 'PAYLOAD_TOO_LARGE';
      message = 'Request body exceeds the size limit';
    }
  }

  if (status >= 500) {
    // Never log request bodies, database URLs, tokens or raw driver errors.
    console.error(JSON.stringify({ event: 'request_failed', code, requestId: response.locals.requestId }));
  }

  response.status(status).json({
    error: {
      code,
      message,
      ...(details === undefined ? {} : { details }),
      requestId: response.locals.requestId,
    },
  });
};
