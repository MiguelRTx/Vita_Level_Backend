import assert from 'node:assert/strict';
import { test } from 'node:test';
import request from 'supertest';
import { Router } from 'express';
import { createAuthRouter } from '../src/modules/auth/auth.routes.ts';
import type { AuthService } from '../src/modules/auth/auth.service.ts';
import { AppError } from '../src/shared/errors/app-error.ts';
import { createApp } from '../src/app.ts';
import { registerSchema } from '../src/modules/auth/auth.validation.ts';
import { createActivitySchema } from '../src/modules/activities/activities.validation.ts';
import { plainText } from '../src/shared/validation.ts';

test('text validation normalizes Unicode and line endings without damaging legitimate punctuation', () => {
  assert.equal(plainText(120).parse("  O'Connor: cafe\u0301\r\nAprender 2 < 3  "), "O'Connor: café\nAprender 2 < 3");
  for (const value of ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>', 'text\u0000', 'text\u202E']) assert.equal(plainText(120).safeParse(value).success, false);
});
test('passwords are not trimmed or normalized and spam honeypots are rejected', () => {
  const body = { email: '  USER@EXAMPLE.TEST ', displayName: ' User ', password: '  a-long-password  ' };
  const result = registerSchema.parse(body);
  assert.equal(result.password, body.password); assert.equal(result.email, 'user@example.test');
  assert.equal(registerSchema.safeParse({ ...body, website: 'bot.example' }).success, false);
});
test('invalid fields, HTML, forged owner and XP never pass activity validation', () => {
  const input = { title: 'Study', categoryId: 'e038c611-ab9b-49f5-a0e1-a0f425cd1d6e', frequency: 'DAILY', startDate: '2030-01-01', targetQuantity: '30', unit: 'minutes' };
  for (const patch of [{ title: '<script>x</script>' }, { userId: input.categoryId }, { xpPerCompletion: 999 }, { targetQuantity: '-1' }, { startDate: '2030-02-30' }]) assert.equal(createActivitySchema.safeParse({ ...input, ...patch }).success, false);
});
test('global rate limiting returns 429 with retry headers and a structured error', async () => {
  const app = createApp({ healthRepository: { ping: async () => {} }, corsOrigins: [], rateLimitMax: 2 });
  assert.equal((await request(app).get('/live')).status, 200);
  assert.equal((await request(app).get('/live')).status, 200);
  const blocked = await request(app).get('/live');
  assert.equal(blocked.status, 429); assert.equal(blocked.body.error.code, 'RATE_LIMITED'); assert.ok(blocked.headers['retry-after']);
});
test('CORS rejects unlisted and null browser origins and API CSP blocks document scripts', async () => {
  const app = createApp({ healthRepository: { ping: async () => {} }, corsOrigins: ['http://localhost:5173'] });
  assert.equal((await request(app).get('/live').set('Origin', 'null')).status, 403);
  assert.equal((await request(app).get('/live').set('Origin', 'https://attacker.test')).status, 403);
  const allowed = await request(app).options('/api/v1/me').set('Origin', 'http://localhost:5173').set('Access-Control-Request-Method', 'GET');
  assert.equal(allowed.status, 204); assert.equal(allowed.headers['access-control-allow-origin'], 'http://localhost:5173');
  assert.match(String(allowed.headers['content-security-policy']), /default-src 'none'/);
});
test('login attempts are bounded by account independently from the global limiter', async () => {
  const api = Router();
  api.use('/auth', createAuthRouter({ login: async () => { throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid credentials'); } } as unknown as AuthService));
  const app = createApp({ healthRepository: { ping: async () => {} }, corsOrigins: [], apiRouter: api });
  for (let index = 0; index < 10; index++) assert.equal((await request(app).post('/api/v1/auth/login').send({ email: 'attempts@example.test', password: 'wrong' })).status, 401);
  const blocked = await request(app).post('/api/v1/auth/login').send({ email: 'ATTEMPTS@example.test', password: 'wrong' });
  assert.equal(blocked.status, 429); assert.ok(blocked.headers['retry-after']);
  assert.equal((await request(app).post('/api/v1/auth/login').send({ email: 'different@example.test', password: 'wrong' })).status, 401);
});
