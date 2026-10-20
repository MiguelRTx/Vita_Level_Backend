import assert from 'node:assert/strict';
import { test } from 'node:test';
import { envSchema } from '../src/config/env.ts';

const base = { DATABASE_URL: 'postgresql://test:test@localhost:5432/gamification_test' };

test('configuration has explicit defaults and normalizes the CORS list', () => {
  const env = envSchema.parse({ ...base, CORS_ORIGINS: 'http://localhost:5173, https://app.example' });
  assert.equal(env.PORT, 3000);
  assert.equal(env.XP_PER_COMPLETION, 20);
  assert.equal(env.DEFAULT_TIME_ZONE, 'America/La_Paz');
  assert.deepEqual(env.CORS_ORIGINS, ['http://localhost:5173', 'https://app.example']);
});

test('invalid port, non-PostgreSQL URL, time zone, XP and CORS origins fail validation', () => {
  for (const invalid of [
    { PORT: '0' }, { DATABASE_URL: 'https://example.com' }, { DEFAULT_TIME_ZONE: 'Not/AZone' },
    { XP_PER_COMPLETION: '0' }, { CORS_ORIGINS: '*' }, { CORS_ORIGINS: 'https://app.example/path' },
  ]) {
    assert.equal(envSchema.safeParse({ ...base, ...invalid }).success, false);
  }
});
