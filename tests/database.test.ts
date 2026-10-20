import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.ts';
import { createDatabaseClient } from '../src/database/client.ts';
import { createHealthRepository } from '../src/modules/health/health.repository.ts';
import { seedCatalog, levels } from '../prisma/catalog.ts';
import type { Prisma } from '../src/generated/prisma/client.ts';

const connectionString = process.env.DATABASE_URL;
if (!connectionString || process.env.NODE_ENV !== 'test' || !new URL(connectionString).pathname.endsWith('_test')) {
  throw new Error('Use NODE_ENV=test and DATABASE_URL pointing to a dedicated database ending in _test.');
}
const database = createDatabaseClient(connectionString);
after(async () => { await database.$disconnect(); });

async function fixture(transaction: Prisma.TransactionClient) {
  const user = await transaction.user.create({ data: {
    email: `${randomUUID()}@example.test`, passwordHash: 'test-only-not-a-real-password-hash', displayName: 'Test',
  } });
  const category = await transaction.category.findUniqueOrThrow({ where: { slug: 'study' } });
  const activity = await transaction.activity.create({ data: {
    userId: user.id, frequency: 'WEEKLY', startDate: new Date('2026-10-12'), scheduleTimeZone: 'America/La_Paz',
  } });
  const revision = await transaction.activityRevision.create({ data: {
    activityId: activity.id, userId: user.id, version: 1, effectiveFrom: new Date('2026-10-12'),
    title: 'Study', categoryId: category.id, targetQuantity: '30.000', unit: 'minutes', targetCount: 3, xpPerCompletion: 20,
  } });
  const occurrence = await transaction.occurrence.create({ data: {
    activityId: activity.id, revisionId: revision.id, userId: user.id,
    periodStartDate: new Date('2026-10-12'), scheduledDate: new Date('2026-10-12'),
    startsAt: new Date('2026-10-12T04:00:00Z'), endsAt: new Date('2026-10-19T04:00:00Z'),
  } });
  const unit = await transaction.occurrenceUnit.create({ data: {
    occurrenceId: occurrence.id, userId: user.id, position: 1,
  } });
  return { user, category, activity, revision, occurrence, unit };
}

test('real database health check succeeds', async () => {
  const app = createApp({ healthRepository: createHealthRepository(database), corsOrigins: [] });
  const response = await request(app).get('/health');
  assert.equal(response.status, 200);
  assert.equal(response.body.data.database, 'up');
});

test('seed can run twice without duplicates and level thresholds are strictly increasing', async () => {
  await seedCatalog(database);
  const counts = async () => Promise.all([
    database.category.count(), database.level.count(), database.badge.count(), database.reward.count(),
  ]);
  const before = await counts();
  await seedCatalog(database);
  assert.deepEqual(await counts(), before);
  assert.deepEqual(before, [4, 50, 5, 3]);
  const saved = await database.level.findMany({ orderBy: { number: 'asc' } });
  assert.deepEqual(saved, levels);
  assert.equal(saved[0]?.minTotalXp, 0);
  for (let index = 1; index < saved.length; index += 1) {
    assert.ok(saved[index]!.minTotalXp > saved[index - 1]!.minTotalXp);
  }
});

test('a unit cannot have two completions, even under different request IDs', async () => {
  await assert.rejects(database.$transaction(async (transaction) => {
    const { user, unit } = await fixture(transaction);
    const data = { userId: user.id, occurrenceUnitId: unit.id, localDate: new Date('2026-10-12'), timeZone: 'America/La_Paz' };
    await transaction.completion.create({ data });
    await transaction.completion.create({ data });
  }), { code: 'P2002' });
});

test('a completion cannot grant XP twice', async () => {
  await assert.rejects(database.$transaction(async (transaction) => {
    const { user, unit } = await fixture(transaction);
    const completion = await transaction.completion.create({ data: {
      userId: user.id, occurrenceUnitId: unit.id, localDate: new Date('2026-10-12'), timeZone: 'America/La_Paz',
    } });
    const data = { userId: user.id, completionId: completion.id, amount: 20 };
    await transaction.xpMovement.create({ data });
    await transaction.xpMovement.create({ data });
  }), { code: 'P2002' });
});

test('composite foreign keys prevent mixing resources from different users', async () => {
  await assert.rejects(database.$transaction(async (transaction) => {
    const { unit } = await fixture(transaction);
    const other = await transaction.user.create({ data: {
      email: `${randomUUID()}@example.test`, passwordHash: 'test-only', displayName: 'Other',
    } });
    await transaction.completion.create({ data: {
      userId: other.id, occurrenceUnitId: unit.id, localDate: new Date('2026-10-12'), timeZone: 'America/La_Paz',
    } });
  }), { code: 'P2003' });
});

test('active days are unique, preventing multiple daily streak increments', async () => {
  await assert.rejects(database.$transaction(async (transaction) => {
    const { user } = await fixture(transaction);
    const data = { userId: user.id, localDate: new Date('2026-10-12') };
    await transaction.activeDay.create({ data });
    await transaction.activeDay.create({ data });
  }), { code: 'P2002' });
});

test('an idempotency key cannot be reused to add partial progress', async () => {
  await assert.rejects(database.$transaction(async (transaction) => {
    const { user, unit } = await fixture(transaction);
    const data = {
      userId: user.id, occurrenceUnitId: unit.id, idempotencyKey: randomUUID(), requestHash: 'a'.repeat(64),
      amount: '10.000', localDate: new Date('2026-10-12'), timeZone: 'America/La_Paz', responseBody: { data: {} },
    };
    await transaction.progressEntry.create({ data });
    await transaction.progressEntry.create({ data });
  }), { code: 'P2002' });
});

test('badge and reward grants are unique per user', async () => {
  for (const kind of ['badge', 'reward'] as const) {
    await assert.rejects(database.$transaction(async (transaction) => {
      const { user } = await fixture(transaction);
      if (kind === 'badge') {
        const badge = await transaction.badge.findFirstOrThrow();
        const data = { userId: user.id, badgeId: badge.id };
        await transaction.userBadge.create({ data });
        await transaction.userBadge.create({ data });
      } else {
        const reward = await transaction.reward.findFirstOrThrow();
        const data = { userId: user.id, rewardId: reward.id };
        await transaction.userReward.create({ data });
        await transaction.userReward.create({ data });
      }
    }), { code: 'P2002' });
  }
});

test('database CHECK constraints reject negative XP', async () => {
  await assert.rejects(database.$transaction(async (transaction) => {
    await transaction.user.create({ data: {
      email: `${randomUUID()}@example.test`, passwordHash: 'test-only', displayName: 'Invalid', totalXp: -1,
    } });
  }), /constraint/i);
});

test('the unique XP source constraint survives concurrent inserts', async () => {
  const { user, unit } = await database.$transaction(fixture);
  try {
    const completion = await database.completion.create({ data: {
      userId: user.id, occurrenceUnitId: unit.id, localDate: new Date('2026-10-12'), timeZone: 'America/La_Paz',
    } });
    const outcomes = await Promise.allSettled(Array.from({ length: 10 }, () =>
      database.xpMovement.create({ data: { userId: user.id, completionId: completion.id, amount: 20 } }),
    ));
    assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 1);
    const failures = outcomes.filter((outcome) => outcome.status === 'rejected');
    assert.equal(failures.length, 9);
    for (const failure of failures) assert.equal(failure.reason.code, 'P2002');
    const result = await database.xpMovement.aggregate({ where: { userId: user.id }, _sum: { amount: true }, _count: true });
    assert.equal(result._sum.amount, 20);
    assert.equal(result._count, 1);
  } finally {
    // Only this test's UUID-scoped fixture is removed, in FK dependency order.
    await database.$transaction(async (transaction) => {
      await transaction.xpMovement.deleteMany({ where: { userId: user.id } });
      await transaction.completion.deleteMany({ where: { userId: user.id } });
      await transaction.occurrenceUnit.deleteMany({ where: { userId: user.id } });
      await transaction.occurrence.deleteMany({ where: { userId: user.id } });
      await transaction.activityRevision.deleteMany({ where: { userId: user.id } });
      await transaction.activity.deleteMany({ where: { userId: user.id } });
      await transaction.user.delete({ where: { id: user.id } });
    });
  }
});
