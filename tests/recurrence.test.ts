import assert from 'node:assert/strict';
import { test } from 'node:test';
import { periodBounds } from '../src/modules/activities/recurrence.ts';
import { buildTimeSeries, dashboardQuerySchema, statisticsQuerySchema } from '../src/modules/statistics/statistics.service.ts';

test('statistics projection does not mutate events and is independent of the system clock', () => {
  const events = Object.freeze([
    Object.freeze({ date: '2030-01-01', xp: 20 }),
    Object.freeze({ date: '2030-01-02', xp: 40 }),
  ]);
  const before = structuredClone(events);
  const first = buildTimeSeries('2030-01-01', '2030-01-07', 'WEEK', events, 100);
  const second = buildTimeSeries('2030-01-01', '2030-01-07', 'WEEK', events, 100);
  assert.deepEqual(first, second);
  assert.deepEqual(events, before);
  assert.equal(first.xpSeries[0]!.cumulativeXp, 160);
});

test('daily boundaries follow daylight saving changes instead of adding 24 hours', () => {
  const spring = periodBounds('DAILY', '2026-03-08', 'America/New_York', '2026-03-01', null);
  const autumn = periodBounds('DAILY', '2026-11-01', 'America/New_York', '2026-03-01', null);
  assert.equal((spring.endsAt.getTime() - spring.startsAt.getTime()) / 3600000, 23);
  assert.equal((autumn.endsAt.getTime() - autumn.startsAt.getTime()) / 3600000, 25);
});
test('weekly periods start on Monday and partial first/last weeks are clipped', () => {
  const result = periodBounds('WEEKLY', '2030-01-09', 'America/La_Paz', '2030-01-09', '2030-01-11');
  assert.equal(result.periodStartDate, '2030-01-07'); assert.equal(result.scheduledDate, '2030-01-09');
  assert.equal(result.startsAt.toISOString(), '2030-01-09T04:00:00.000Z');
  assert.equal(result.endsAt.toISOString(), '2030-01-12T04:00:00.000Z');
});
test('time series include zero intervals and retain opening balance across month/year boundaries', () => {
  const result = buildTimeSeries('2029-12-31', '2030-02-01', 'MONTH', [{ date: '2030-02-01', xp: 20 }], 40);
  assert.deepEqual(result.xpSeries.map((item) => [item.earnedXp, item.cumulativeXp]), [[0, 40], [0, 40], [20, 60]]);
  assert.equal(result.heatmap.length, 33); assert.equal(result.heatmap[0]!.count, 0); assert.equal(result.heatmap[32]!.count, 1);
});

test('dashboard rejects an activity filter that would mix activity totals with global planning', () => {
  const query = { from: '2030-01-01', to: '2030-01-07', activityId: 'e038c611-ab9b-49f5-a0e1-a0f425cd1d6e' };
  assert.equal(dashboardQuerySchema.safeParse(query).success, false);
  assert.equal(statisticsQuerySchema.safeParse(query).success, true);
});
