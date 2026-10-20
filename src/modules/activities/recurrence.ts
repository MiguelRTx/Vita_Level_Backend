import { DateTime } from 'luxon';
import type { Prisma } from '../../generated/prisma/client.ts';
import { civil, dbDate, todayIn } from '../../shared/domain.ts';
import { activityInclude, currentRevision, type ActivityRow } from './activities.repository.ts';

export function periodBounds(frequency: ActivityRow['frequency'], date: string, zone: string, startDate: string, endDate: string | null) {
  const day = DateTime.fromISO(date, { zone }).startOf('day');
  const natural = frequency === 'WEEKLY' ? day.startOf('week') : frequency === 'ONCE' ? DateTime.fromISO(startDate, { zone }) : day;
  const start = DateTime.max(natural, DateTime.fromISO(startDate, { zone }));
  const naturalEnd = frequency === 'ONCE' ? DateTime.fromISO(endDate!, { zone }).plus({ days: 1 }) : natural.plus(frequency === 'WEEKLY' ? { weeks: 1 } : { days: 1 });
  const end = endDate ? DateTime.min(naturalEnd, DateTime.fromISO(endDate, { zone }).plus({ days: 1 })) : naturalEnd;
  return { periodStartDate: natural.toISODate()!, scheduledDate: start.toISODate()!, startsAt: start.toJSDate(), endsAt: end.toJSDate() };
}

// Call only inside a transaction holding the user's lock. No cron or future XP.
export async function materializeActivity(tx: Prisma.TransactionClient, activity: ActivityRow, now: Date) {
  if (activity.archivedAt) return;
  const today = todayIn(now, activity.scheduleTimeZone);
  const startDate = civil(activity.startDate);
  if (startDate > today || (activity.materializedThrough && civil(activity.materializedThrough) >= today)) return;
  let cursor = activity.materializedThrough ? DateTime.fromISO(civil(activity.materializedThrough), { zone: 'UTC' }).plus({ days: 1 }).toISODate()! : startDate;
  while (cursor <= today) {
    const natural = activity.frequency === 'WEEKLY' ? DateTime.fromISO(cursor, { zone: 'UTC' }).startOf('week').toISODate()! : cursor;
    const scheduled = natural < startDate ? startDate : natural;
    const revision = currentRevision(activity, scheduled);
    const endDate = revision.endDate ? civil(revision.endDate) : null;
    if (!endDate || scheduled <= endDate) {
      const bounds = periodBounds(activity.frequency, cursor, activity.scheduleTimeZone, startDate, endDate);
      await tx.occurrence.upsert({
        where: { activityId_periodStartDate: { activityId: activity.id, periodStartDate: dbDate(bounds.periodStartDate) } }, update: {},
        create: { activityId: activity.id, revisionId: revision.id, userId: activity.userId, periodStartDate: dbDate(bounds.periodStartDate), scheduledDate: dbDate(bounds.scheduledDate), startsAt: bounds.startsAt, endsAt: bounds.endsAt,
          units: { create: Array.from({ length: revision.targetCount }, (_, index) => ({ position: index + 1 })) } },
      });
    }
    if (activity.frequency === 'ONCE') break;
    cursor = DateTime.fromISO(natural, { zone: 'UTC' }).plus(activity.frequency === 'WEEKLY' ? { weeks: 1 } : { days: 1 }).toISODate()!;
  }
  await tx.activity.update({ where: { id: activity.id }, data: { materializedThrough: dbDate(today) } });
}
export async function materializeAll(tx: Prisma.TransactionClient, userId: string, now: Date) {
  const activities = await tx.activity.findMany({ where: { userId, archivedAt: null }, include: activityInclude });
  for (const activity of activities) await materializeActivity(tx, activity, now);
}
