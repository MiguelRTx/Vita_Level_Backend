import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DateTime } from 'luxon';
import { calculateLevel, calculateStreak } from '../src/modules/gamification/summary.ts';
import { levels } from '../prisma/catalog.ts';
import { authEnvironmentSchema } from '../src/config/env.ts';

test('gamification calculations are deterministic and accept frozen inputs', () => {
  const thresholds = Object.freeze(levels.map((level) => Object.freeze({ ...level })));
  const days = Object.freeze(['2026-01-02', '2026-01-01', '2026-01-02']);
  const thresholdsBefore = structuredClone(thresholds);
  const daysBefore = [...days];
  assert.deepEqual(calculateLevel(410, thresholds), calculateLevel(410, thresholds));
  assert.deepEqual(calculateStreak(days, '2026-01-02'), calculateStreak(days, '2026-01-02'));
  assert.deepEqual(thresholds, thresholdsBefore);
  assert.deepEqual(days, daysBefore);
});

test('level thresholds include boundaries and skip intermediate levels', () => {
  for (const [xp, level] of [[0, 1], [99, 1], [100, 2], [399, 2], [400, 3], [410, 3], [1600, 5]]) {
    assert.equal(calculateLevel(xp!, levels).level, level);
  }
  const result = calculateLevel(410, levels);
  assert.equal(result.xpInLevel, 10);
  assert.equal(result.xpRequiredForNextLevel, 500);
  assert.equal(result.xpToNextLevel, 490);
});

test('maximum level has no next level and avoids division by zero', () => {
  const result = calculateLevel(300000, levels);
  assert.equal(result.level, 50);
  assert.equal(result.nextLevel, null);
  assert.equal(result.xpToNextLevel, null);
  assert.equal(result.xpRequiredForNextLevel, null);
  assert.equal(result.levelProgress, 1);
});

test('streaks use distinct local dates and expire without writes', () => {
  assert.deepEqual(calculateStreak([], '2026-01-02'), { currentStreak: 0, bestStreak: 0 });
  const days = ['2025-12-30', '2025-12-31', '2026-01-01', '2026-01-01'];
  assert.deepEqual(calculateStreak(days, '2026-01-01'), { currentStreak: 3, bestStreak: 3 });
  assert.deepEqual(calculateStreak(days, '2026-01-02'), { currentStreak: 3, bestStreak: 3 });
  assert.deepEqual(calculateStreak(days, '2026-01-03'), { currentStreak: 0, bestStreak: 3 });
  assert.deepEqual(calculateStreak([...days, '2026-01-04'], '2026-01-04'), { currentStreak: 1, bestStreak: 3 });
});

test('the current local day differs from UTC and DST does not break calendar adjacency', () => {
  const instant = DateTime.fromISO('2026-10-19T02:00:00Z');
  const today = instant.setZone('America/La_Paz').toISODate()!;
  assert.equal(today, '2026-10-18');
  assert.equal(calculateStreak(['2026-10-17'], today).currentStreak, 1);
  assert.equal(calculateStreak(['2026-03-07', '2026-03-08', '2026-03-09'], '2026-03-09').currentStreak, 3);
});

test('authentication refuses missing or placeholder secrets', () => {
  assert.equal(authEnvironmentSchema.safeParse({}).success, false);
  assert.equal(authEnvironmentSchema.safeParse({ JWT_SECRET: 'REPLACE_WITH_A_RANDOM_SECRET_OF_AT_LEAST_32_CHARACTERS' }).success, false);
  assert.equal(authEnvironmentSchema.safeParse({ JWT_SECRET: 'x'.repeat(48) }).success, true);
});
