import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.ts';
import { createApiRouter } from '../src/routes.ts';
import { createDatabaseClient } from '../src/database/client.ts';
import { createHealthRepository } from '../src/modules/health/health.repository.ts';
import { seedCatalog } from '../prisma/catalog.ts';

const url = process.env.DATABASE_URL;
if (!url || process.env.NODE_ENV !== 'test' || !new URL(url).pathname.endsWith('_test')) throw new Error('Use a dedicated _test database.');
const database = createDatabaseClient(process.env.MIGRATION_DATABASE_URL ?? url);
const applicationDatabase = createDatabaseClient(url);
const config = { JWT_SECRET: randomBytes(48).toString('base64url'), JWT_ISSUER: 'workflow', JWT_AUDIENCE: 'workflow', JWT_TTL_SECONDS: 3600 };
let now = new Date('2030-01-07T16:00:00Z'); // Monday, injected into domain services only.
const app = createApp({ healthRepository: createHealthRepository(database), corsOrigins: [], apiRouter: createApiRouter(applicationDatabase, config, 'America/La_Paz', 20, () => now) });
let token: string, otherToken: string, owner: string, otherOwner: string;
let categories: { id: string; slug: string }[];
let weeklyId: string, weeklyOccurrenceId: string, units: { id: string }[];
let dailyId: string;
const send = (method: 'get' | 'post' | 'patch', path: string, auth = token) => request(app)[method](`/api/v1${path}`).auth(auth, { type: 'bearer' });
const record = (id: string, amount: string, key = randomUUID(), auth = token) => send('post', `/occurrence-units/${id}/progress`, auth).set('Idempotency-Key', key).send({ amount });
async function create(overrides: Record<string, unknown> = {}) {
  const result = await send('post', '/activities').send({ title: 'Test activity', categoryId: categories[0]!.id, frequency: 'DAILY', startDate: now.toISOString().slice(0, 10), targetQuantity: '30', unit: 'minutes', ...overrides });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  return result.body.data;
}
async function occurrences(id: string, from = '2030-01-07', to = '2030-01-14') {
  const result = await send('get', `/activities/${id}/occurrences?from=${from}&to=${to}`);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return result.body.data;
}
before(async () => {
  await seedCatalog(database);
  const register = () => request(app).post('/api/v1/auth/register').send({ displayName: 'Workflow', email: `${randomUUID()}@example.test`, password: 'Test-workflow-password-123' });
  const first = await register(); const second = await register();
  assert.equal(first.status, 201); assert.equal(second.status, 201);
  token = first.body.data.accessToken; owner = first.body.data.user.id;
  otherToken = second.body.data.accessToken; otherOwner = second.body.data.user.id;
  categories = (await send('get', '/categories')).body.data;
});
after(async () => {
  const where = { userId: { in: [owner, otherOwner].filter(Boolean) } };
  try { await database.$transaction(async (tx) => {
    await tx.xpMovement.deleteMany({ where }); await tx.progressEntry.deleteMany({ where }); await tx.completion.deleteMany({ where });
    await tx.occurrenceUnit.deleteMany({ where }); await tx.occurrence.deleteMany({ where }); await tx.activityRevision.deleteMany({ where }); await tx.activity.deleteMany({ where }); await tx.project.deleteMany({ where });
    await tx.userBadge.deleteMany({ where }); await tx.userReward.deleteMany({ where }); await tx.activeDay.deleteMany({ where }); await tx.session.deleteMany({ where }); await tx.user.deleteMany({ where: { id: where.userId } });
  }); } finally { await applicationDatabase.$disconnect(); await database.$disconnect(); }
});
test('weekly units and partial progress are explicit; duplicate requests replay the same response', async () => {
  const activity = await create({ frequency: 'WEEKLY', targetCount: 3 });
  weeklyId = activity.id;
  const rows = await occurrences(weeklyId);
  assert.equal(rows.length, 1); assert.equal(rows[0].units.length, 3);
  weeklyOccurrenceId = rows[0].id; units = rows[0].units;
  const key = randomUUID();
  const results = await Promise.all(Array.from({ length: 5 }, () => record(units[0]!.id, '10.000', key)));
  assert.equal(results.filter((result) => result.status === 201).length, 1);
  assert.equal(results.filter((result) => result.status === 200).length, 4);
  for (const result of results) assert.deepEqual(result.body, results[0]!.body);
  assert.equal(results[0]!.body.data.xpGranted, 0);
  assert.equal(results[0]!.body.data.occurrence.units[0].progressQuantity, '10.000');
  assert.equal((await record(units[0]!.id, '11', key)).status, 409);
  assert.equal((await record(units[0]!.id, '21')).status, 422);
  assert.equal(await database.xpMovement.count({ where: { userId: owner } }), 0);
});
test('concurrent completions with different keys award XP and a badge exactly once', async () => {
  const results = await Promise.all([record(units[0]!.id, '20'), record(units[0]!.id, '20')]);
  assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);
  const success = results.find((result) => result.status === 201)!;
  assert.equal(success.body.data.xpGranted, 20);
  assert.equal(success.body.data.newBadges.length, 1);
  assert.equal(success.body.data.gamification.currentStreak, 1);
  assert.equal(success.body.data.occurrence.status, 'PENDING');
  const key = randomUUID();
  const result = await record(units[1]!.id, '30', key);
  assert.equal(result.status, 201);
  const replay = await record(units[1]!.id, '30.000', key);
  assert.equal(replay.status, 200); assert.deepEqual(replay.body, result.body);
  assert.equal((await record(units[2]!.id, '30')).body.data.occurrence.status, 'COMPLETED');
  assert.equal((await database.user.findUniqueOrThrow({ where: { id: owner } })).totalXp, 60);
  assert.equal(await database.xpMovement.count({ where: { userId: owner } }), 3);
  assert.equal(await database.activeDay.count({ where: { userId: owner } }), 1);
});
test('all activity, occurrence, progress, project, history and dashboard data are isolated', async () => {
  assert.equal((await send('get', `/activities/${weeklyId}`, otherToken)).status, 404);
  assert.equal((await send('patch', `/activities/${weeklyId}`, otherToken).send({ title: 'Hijack' })).status, 404);
  assert.equal((await send('post', `/activities/${weeklyId}/archive`, otherToken)).status, 404);
  assert.equal((await send('get', `/occurrences/${weeklyOccurrenceId}`, otherToken)).status, 404);
  assert.equal((await record(units[0]!.id, '1', randomUUID(), otherToken)).status, 404);
  assert.equal((await send('get', `/occurrence-units/${units[0]!.id}/progress`, otherToken)).status, 404);
  const history = await send('get', '/history/completions?from=2030-01-01&to=2030-01-07', otherToken);
  assert.deepEqual(history.body.data, []);
  const dashboard = await send('get', '/dashboard?from=2030-01-01&to=2030-01-07', otherToken);
  assert.equal(dashboard.body.data.earned.xpEarned, 0);
  assert.equal(dashboard.body.data.planning.completionPercentage, 0);
  assert.equal(dashboard.body.data.earned.heatmap.length, 7);
});
test('revisions preserve completed history and take effect at the next weekly boundary', async () => {
  const result = await send('patch', `/activities/${weeklyId}`).send({ title: 'New weekly terms', targetQuantity: '5', targetCount: 2 });
  assert.equal(result.status, 200);
  assert.equal(result.body.data.currentRevision.targetQuantity, '30.000');
  assert.equal(result.body.data.pendingRevision.effectiveFrom, '2030-01-14');
  assert.equal((await send('patch', `/activities/${weeklyId}`).send({ title: 'Second pending edit' })).status, 409);
  const history = await send('get', '/history/completions?from=2030-01-07&to=2030-01-07&pageSize=2');
  assert.equal(history.body.pagination.totalItems, 3); assert.equal(history.body.pagination.totalPages, 2);
  assert.ok(history.body.data.every((item: { activityTitle: string }) => item.activityTitle === 'Test activity'));
  dailyId = (await create()).id;
});
test('daily periods expire on read; weekly completion does not complete future periods', async () => {
  now = new Date('2030-01-14T16:00:00Z');
  const weekly = await occurrences(weeklyId);
  assert.equal(weekly.length, 2);
  assert.equal(weekly[0].status, 'PENDING'); assert.equal(weekly[0].units.length, 2);
  assert.equal(weekly[0].revision.title, 'New weekly terms');
  assert.equal(weekly[1].status, 'COMPLETED'); assert.equal(weekly[1].revision.title, 'Test activity');
  const daily = await occurrences(dailyId);
  assert.equal(daily.length, 8); assert.equal(daily.filter((row: { status: string }) => row.status === 'OVERDUE').length, 7);
  assert.equal((await record(daily[1].units[0].id, '30')).status, 409);
  const result = await record(daily[0].units[0].id, '30');
  assert.equal(result.status, 201); assert.equal(result.body.data.gamification.currentStreak, 1);
  const levelUp = await record(weekly[0].units[0].id, '5');
  assert.equal(levelUp.body.data.gamification.totalXp, 100); assert.equal(levelUp.body.data.gamification.level, 2);
  assert.equal(levelUp.body.data.newRewards[0].code, 'explorer-title');
});
test('dashboard separates programmed dates, sessions, closures, interval XP and cumulative XP', async () => {
  const result = await send('get', '/dashboard?from=2030-01-14&to=2030-01-14');
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const data = result.body.data;
  assert.equal(data.planning.plannedOccurrences, 2); assert.equal(data.planning.completedOccurrences, 1);
  assert.equal(data.planning.completionPercentage, 50);
  assert.equal(data.earned.completionCount, 2); assert.equal(data.earned.goalsReached, 1);
  assert.equal(data.earned.openingXp, 60); assert.equal(data.earned.xpEarned, 40);
  assert.deepEqual(data.earned.xpSeries, [{ startDate: '2030-01-14', endDate: '2030-01-14', earnedXp: 40, cumulativeXp: 100 }]);
  assert.equal(data.earned.heatmap[0].count, 2);
  assert.equal(data.planning.byCategory.length, 4);
  const empty = await send('get', `/dashboard?from=2030-01-01&to=2030-01-14&categoryId=${categories[1]!.id}`);
  assert.equal(empty.body.data.earned.openingXp, 0); assert.equal(empty.body.data.earned.xpEarned, 0);
  assert.ok(empty.body.data.earned.xpSeries.every((point: { earnedXp: number }) => point.earnedXp === 0));
  assert.equal((await send('get', '/dashboard?from=2030-01-01&to=2030-01-15')).status, 422);
  assert.equal((await send('get', '/dashboard?from=2030-02-30&to=2030-03-01')).status, 422);
});
test('project tasks use the same completion system and archive retains earned XP', async () => {
  const project = await send('post', '/projects').send({ title: 'Final project', startDate: '2030-01-14', endDate: '2030-01-30' });
  assert.equal(project.status, 201);
  const id = project.body.data.id;
  assert.equal((await send('get', `/projects/${id}`, otherToken)).status, 404);
  const task = await create({ frequency: 'ONCE', endDate: '2030-01-20', projectId: id, categoryId: categories.find((category) => category.slug === 'personal-projects')!.id, targetQuantity: '1', unit: 'task' });
  const rows = await occurrences(task.id);
  assert.equal((await record(rows[0].units[0].id, '1')).status, 201);
  assert.equal((await send('get', `/projects/${id}`)).body.data.progressPercentage, 100);
  assert.equal((await send('patch', `/activities/${task.id}`).send({ title: 'Rewrite history' })).status, 409);
  assert.equal((await send('patch', `/projects/${id}`).send({ endDate: '2030-01-15' })).status, 422);
  assert.equal((await send('post', `/projects/${id}/archive`)).status, 200);
  assert.ok((await send('get', `/activities/${task.id}`)).body.data.archivedAt);
  assert.equal((await database.user.findUniqueOrThrow({ where: { id: owner } })).totalXp, 120);
  assert.equal((await send('post', `/activities/${dailyId}/archive`)).status, 200);
  assert.equal((await send('post', `/activities/${dailyId}/archive`)).status, 200);
});
test('input cannot inject XP, owner, absolute progress or retroactive completions', async () => {
  assert.equal((await send('post', '/activities').send({ title: 'Spoof', categoryId: categories[0]!.id, frequency: 'DAILY', startDate: '2030-01-14', targetQuantity: '1', unit: 'task', xpPerCompletion: 1000 })).status, 422);
  assert.equal((await send('post', `/occurrence-units/${units[0]!.id}/progress`).set('Idempotency-Key', randomUUID()).send({ amount: '1', completedAt: '2030-01-01T12:00:00Z' })).status, 422);
  assert.equal((await send('post', '/activities').send({ title: 'Past', categoryId: categories[0]!.id, frequency: 'DAILY', startDate: '2030-01-01', targetQuantity: '1', unit: 'task' })).status, 422);
});
test('a failure after inserting a completion rolls back progress, ledger and completion together', async () => {
  const activity = await create({ targetQuantity: '1' });
  const rows = await occurrences(activity.id);
  const before = await database.user.findUniqueOrThrow({ where: { id: owner } });
  const entryCount = await database.progressEntry.count({ where: { userId: owner } });
  const ledgerCount = await database.xpMovement.count({ where: { userId: owner } });
  await database.user.update({ where: { id: owner }, data: { totalXp: 2147483647 } });
  try {
    const result = await record(rows[0].units[0].id, '1');
    assert.equal(result.status, 500); // Int overflow after ledger insert deliberately forces rollback.
    assert.equal(await database.progressEntry.count({ where: { userId: owner } }), entryCount);
    assert.equal(await database.xpMovement.count({ where: { userId: owner } }), ledgerCount);
    const unit = await database.occurrenceUnit.findUniqueOrThrow({ where: { id: rows[0].units[0].id }, include: { completion: true } });
    assert.equal(unit.progressQuantity.toString(), '0'); assert.equal(unit.completion, null);
  } finally { await database.user.update({ where: { id: owner }, data: { totalXp: before.totalXp } }); }
});
test('seven local days, ten sessions and four categories award badges once; expired streak reads zero', async () => {
  const ids: string[] = [];
  for (const category of categories) {
    const result = await send('post', '/activities', otherToken).send({ title: 'Daily habit', categoryId: category.id, frequency: 'DAILY', startDate: '2030-01-14', targetQuantity: '1', unit: 'session' });
    assert.equal(result.status, 201); ids.push(result.body.data.id);
  }
  for (let day = 14; day <= 20; day++) {
    now = new Date(`2030-01-${day}T16:00:00Z`);
    for (const id of day === 14 ? ids : [ids[0]!]) {
      const result = await send('get', `/activities/${id}/occurrences?from=2030-01-${day}&to=2030-01-${day}`, otherToken);
      assert.equal(result.status, 200);
      assert.equal((await record(result.body.data[0].units[0].id, '1', randomUUID(), otherToken)).status, 201);
    }
  }
  const earned = await send('get', '/badges', otherToken);
  const codes = earned.body.data.filter((badge: { earnedAt: string | null }) => badge.earnedAt).map((badge: { code: string }) => badge.code).sort();
  assert.deepEqual(codes, ['all-categories', 'first-completion', 'seven-day-streak', 'ten-completions']);
  assert.equal((await send('get', '/me', otherToken)).body.data.gamification.currentStreak, 7);
  assert.equal((await send('patch', '/me', otherToken).send({ timeZone: 'Pacific/Auckland' })).status, 409);
  now = new Date('2030-01-23T16:00:00Z');
  const profile = await send('get', '/me', otherToken);
  assert.equal(profile.body.data.gamification.currentStreak, 0); assert.equal(profile.body.data.gamification.bestStreak, 7);
  assert.equal(await database.userBadge.count({ where: { userId: otherOwner } }), 4);
  assert.equal(await database.userReward.count({ where: { userId: otherOwner } }), 2);
  assert.equal((await send('patch', '/me', otherToken).send({ timeZone: 'Pacific/Auckland' })).status, 200);
});
