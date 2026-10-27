import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import argon2 from 'argon2';
import { decodeJwt, SignJWT } from 'jose';
import request from 'supertest';
import { createApp } from '../src/app.ts';
import { createApiRouter } from '../src/routes.ts';
import { createDatabaseClient } from '../src/database/client.ts';
import { createHealthRepository } from '../src/modules/health/health.repository.ts';
import { seedCatalog } from '../prisma/catalog.ts';

const url = process.env.DATABASE_URL;
if (!url || process.env.NODE_ENV !== 'test' || !new URL(url).pathname.endsWith('_test')) throw new Error('Use NODE_ENV=test and a dedicated _test database.');
const database = createDatabaseClient(process.env.MIGRATION_DATABASE_URL ?? url);
const applicationDatabase = createDatabaseClient(url);
const config = { JWT_SECRET: randomBytes(48).toString('base64url'), JWT_ISSUER: 'test-api', JWT_AUDIENCE: 'test-app', JWT_TTL_SECONDS: 3600 };
const app = createApp({ healthRepository: createHealthRepository(database), corsOrigins: [], apiRouter: createApiRouter(applicationDatabase, config, 'America/La_Paz') });
const password = 'Only-a-test-password-123';
const email = `${randomUUID()}@example.test`;
const ownedIds: string[] = [];
let tokenA: string;
let tokenB: string;
let userA: string;
let userB: string;

before(async () => { await seedCatalog(database); });
after(async () => {
  try {
    await database.$transaction(async (tx) => {
      await tx.userBadge.deleteMany({ where: { userId: { in: ownedIds } } });
      await tx.userReward.deleteMany({ where: { userId: { in: ownedIds } } });
      await tx.activeDay.deleteMany({ where: { userId: { in: ownedIds } } });
      await tx.session.deleteMany({ where: { userId: { in: ownedIds } } });
      await tx.user.deleteMany({ where: { id: { in: ownedIds } } });
    });
  } finally { await applicationDatabase.$disconnect(); await database.$disconnect(); }
});

test('register creates an Argon2id hash and a session without exposing secrets', async () => {
  const response = await request(app).post('/api/v1/auth/register').send({ email: email.toUpperCase(), password, displayName: 'Alice' });
  assert.equal(response.status, 201);
  tokenA = response.body.data.accessToken;
  userA = response.body.data.user.id;
  ownedIds.push(userA);
  assert.equal(response.body.data.user.email, email);
  assert.equal(response.body.data.user.timeZone, 'America/La_Paz');
  assert.equal(JSON.stringify(response.body).includes('password'), false);
  const saved = await database.user.findUniqueOrThrow({ where: { id: userA } });
  assert.ok(saved.passwordHash.startsWith('$argon2id$'));
  assert.equal(await argon2.verify(saved.passwordHash, password), true);
  const claims = decodeJwt(tokenA);
  assert.equal(claims.sub, userA);
  assert.ok(claims.sid);
});

test('register rejects duplicate emails and unauthorized fields', async () => {
  const duplicate = await request(app).post('/api/v1/auth/register').send({ email, password, displayName: 'Duplicate' });
  assert.equal(duplicate.status, 409);
  const injected = await request(app).post('/api/v1/auth/register').send({ email: 'spoof@example.test', password, displayName: 'Spoof', totalXp: 999 });
  assert.equal(injected.status, 422);
  const invalidZone = await request(app).post('/api/v1/auth/register').send({ email: 'timezone@example.test', password, displayName: 'Zone', timeZone: 'MadeUp/Place' });
  assert.equal(invalidZone.status, 422);
});

test('login uses a generic error for unknown user or wrong password', async () => {
  const wrong = await request(app).post('/api/v1/auth/login').send({ email, password: 'Wrong-password' });
  const missing = await request(app).post('/api/v1/auth/login').send({ email: 'missing@example.test', password });
  assert.equal(wrong.status, 401);
  assert.equal(missing.status, 401);
  assert.equal(wrong.body.error.message, missing.body.error.message);
  const valid = await request(app).post('/api/v1/auth/login').send({ email, password });
  assert.equal(valid.status, 200);
  assert.equal(JSON.stringify(valid.body).includes('passwordHash'), false);
});

test('profile and achievement queries are isolated between users', async () => {
  const second = await request(app).post('/api/v1/auth/register').send({ email: `${randomUUID()}@example.test`, password, displayName: 'Bob', timeZone: 'UTC' });
  assert.equal(second.status, 201);
  userB = second.body.data.user.id;
  tokenB = second.body.data.accessToken;
  ownedIds.push(userB);
  const badge = await database.badge.findFirstOrThrow();
  const reward = await database.reward.findFirstOrThrow();
  await database.userBadge.create({ data: { userId: userA, badgeId: badge.id } });
  await database.userReward.create({ data: { userId: userA, rewardId: reward.id } });
  const mine = await request(app).get('/api/v1/me').auth(tokenA, { type: 'bearer' });
  const theirs = await request(app).get('/api/v1/me').auth(tokenB, { type: 'bearer' });
  assert.equal(mine.body.data.id, userA);
  assert.equal(theirs.body.data.id, userB);
  assert.equal(mine.body.data.badges.length, 1);
  assert.equal(theirs.body.data.badges.length, 0);
  assert.equal(mine.body.data.gamification.totalXp, 0);
  assert.equal(mine.body.data.gamification.level, 1);
  assert.equal(JSON.stringify(mine.body).includes('passwordHash'), false);
  const rewards = await request(app).get('/api/v1/rewards').auth(tokenB, { type: 'bearer' });
  assert.ok(rewards.body.data.every((item: { unlockedAt: string | null }) => item.unlockedAt === null));
  const spoof = await request(app).patch('/api/v1/me').auth(tokenA, { type: 'bearer' }).send({ userId: userB, displayName: 'Hacked' });
  assert.equal(spoof.status, 422);
});

test('profile changes persist and invalid zone or XP edits are rejected', async () => {
  const updated = await request(app).patch('/api/v1/me').auth(tokenA, { type: 'bearer' }).send({ displayName: 'Alice updated', timeZone: 'Europe/Madrid' });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.data.displayName, 'Alice updated');
  const reload = await request(app).get('/api/v1/me').auth(tokenA, { type: 'bearer' });
  assert.equal(reload.body.data.timeZone, 'Europe/Madrid');
  assert.equal((await request(app).patch('/api/v1/me').auth(tokenA, { type: 'bearer' }).send({ totalXp: 500 })).status, 422);
  assert.equal((await request(app).patch('/api/v1/me').auth(tokenA, { type: 'bearer' }).send({ timeZone: 'Invalid/Zone' })).status, 422);
});

test('missing, altered, expired and cross-user JWTs are rejected', async () => {
  assert.equal((await request(app).get('/api/v1/me')).status, 401);
  assert.equal((await request(app).get('/api/v1/me').auth(`${tokenA.slice(0, -5)}xxxxx`, { type: 'bearer' })).status, 401);
  const identity = decodeJwt(tokenA);
  const sign = (subject: string, expiration: number) => new SignJWT({ sid: identity.sid }).setProtectedHeader({ alg: 'HS256' }).setSubject(subject).setIssuer(config.JWT_ISSUER).setAudience(config.JWT_AUDIENCE).setIssuedAt().setExpirationTime(expiration).sign(new TextEncoder().encode(config.JWT_SECRET));
  const expired = await sign(userA, Math.floor(Date.now() / 1000) - 1);
  assert.equal((await request(app).get('/api/v1/me').auth(expired, { type: 'bearer' })).status, 401);
  const spoofed = await sign(userB, Math.floor(Date.now() / 1000) + 3600);
  assert.equal((await request(app).get('/api/v1/me').auth(spoofed, { type: 'bearer' })).status, 401);
});

test('logout revokes the actual server session', async () => {
  const response = await request(app).post('/api/v1/auth/logout').auth(tokenA, { type: 'bearer' });
  assert.equal(response.status, 204);
  const session = await database.session.findUniqueOrThrow({ where: { id: decodeJwt(tokenA).sid as string } });
  assert.ok(session.revokedAt);
  assert.equal((await request(app).get('/api/v1/me').auth(tokenA, { type: 'bearer' })).status, 401);
  assert.equal((await request(app).get('/api/v1/me').auth(tokenB, { type: 'bearer' })).status, 200);
});
