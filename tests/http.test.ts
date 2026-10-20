import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import request from 'supertest';
import { z } from 'zod';
import { createApp } from '../src/app.ts';
import { errorHandler } from '../src/shared/middleware/error-handler.ts';

function appWithDatabase(ping: () => Promise<void> = async () => {}) {
  return createApp({ healthRepository: { ping }, corsOrigins: ['http://localhost:5173'] });
}

test('health actually checks the repository and returns 200', async () => {
  let calls = 0;
  const response = await request(appWithDatabase(async () => { calls += 1; })).get('/health');
  assert.equal(response.status, 200);
  assert.equal(calls, 1);
  assert.deepEqual(response.body, { data: { status: 'ok', database: 'up' } });
  assert.ok(response.headers['x-request-id']);
  assert.equal(response.headers['x-powered-by'], undefined);
  assert.equal(response.headers['cache-control'], 'no-store');
});

test('unavailable PostgreSQL returns 503 and never exposes connection secrets', async () => {
  const response = await request(appWithDatabase(async () => {
    throw new Error('postgresql://private:secret@host/db');
  })).get('/health');
  assert.equal(response.status, 503);
  assert.equal(response.body.error.code, 'DATABASE_UNAVAILABLE');
  assert.equal(JSON.stringify(response.body).includes('secret'), false);
  assert.equal(response.body.error.requestId, response.headers['x-request-id']);
});

test('liveness works without consulting PostgreSQL', async () => {
  const response = await request(appWithDatabase(async () => { throw new Error('offline'); })).get('/live');
  assert.equal(response.status, 200);
});

test('unknown routes return a structured 404', async () => {
  const response = await request(appWithDatabase()).get('/api/v1/activities');
  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, 'NOT_FOUND');
});

test('CORS permits configured browser origins and rejects others', async () => {
  const app = appWithDatabase();
  const allowed = await request(app).get('/health').set('Origin', 'http://localhost:5173');
  assert.equal(allowed.headers['access-control-allow-origin'], 'http://localhost:5173');
  const denied = await request(app).get('/health').set('Origin', 'https://unknown.example');
  assert.equal(denied.status, 403);
  assert.equal(denied.headers['access-control-allow-origin'], undefined);
  const preflight = await request(app).options('/api/v1/occurrence-units/id/progress')
    .set('Origin', 'http://localhost:5173')
    .set('Access-Control-Request-Method', 'POST')
    .set('Access-Control-Request-Headers', 'authorization,idempotency-key,content-type');
  assert.equal(preflight.status, 204);
});

test('malformed and oversized JSON are controlled client errors', async () => {
  const malformed = await request(appWithDatabase()).post('/health')
    .set('Content-Type', 'application/json').send('{bad');
  assert.equal(malformed.status, 400);
  assert.equal(malformed.body.error.code, 'INVALID_JSON');
  const oversized = await request(appWithDatabase()).post('/health').send({ text: 'x'.repeat(33000) });
  assert.equal(oversized.status, 413);
});

test('Zod errors use 422 and a field path without returning the input', async () => {
  const app = express();
  app.get('/validation', () => { z.object({ title: z.string() }).parse({ title: 42 }); });
  app.use(errorHandler);
  const response = await request(app).get('/validation');
  assert.equal(response.status, 422);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
  assert.equal(response.body.error.details[0].path, 'title');
});
