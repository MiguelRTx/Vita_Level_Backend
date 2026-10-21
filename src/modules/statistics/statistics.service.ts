import { DateTime } from 'luxon';
import { z } from 'zod';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.ts';
import { civil, dateSchema, dbDate, idSchema, invalid, lockUser, paginate, paginationSchema, rangeSchema, todayIn } from '../../shared/domain.ts';
import { occurrenceDto, occurrenceInclude } from '../activities/activities.repository.ts';
import { materializeAll } from '../activities/recurrence.ts';
import { readSummary } from '../gamification/summary.ts';
import { completionDto, completionInclude } from '../progress/progress.repository.ts';

const statisticsFields = paginationSchema.extend({ from: dateSchema, to: dateSchema, categoryId: idSchema.optional(), interval: z.enum(['WEEK', 'MONTH']).default('WEEK') });
export const dashboardQuerySchema = statisticsFields.strict().refine((value) => rangeSchema.safeParse(value).success, 'Invalid date range');
export const statisticsQuerySchema = statisticsFields.extend({ activityId: idSchema.optional() }).strict().refine((value) => rangeSchema.safeParse(value).success, 'Invalid date range');
export type StatisticsQuery = z.infer<typeof statisticsQuerySchema>;
function completionFilter(userId: string, query: StatisticsQuery): Prisma.CompletionWhereInput {
  return { userId, localDate: { gte: dbDate(query.from), lte: dbDate(query.to) }, occurrenceUnit: { occurrence: { ...(query.activityId ? { activityId: query.activityId } : {}), ...(query.categoryId ? { revision: { categoryId: query.categoryId } } : {}) } } };
}
export function buildTimeSeries(from: string, to: string, interval: 'WEEK' | 'MONTH', events: ReadonlyArray<Readonly<{ date: string; xp: number }>>, openingXp: number) {
  const heatmap: { date: string; count: number }[] = [];
  const xpSeries: { startDate: string; endDate: string; earnedXp: number; cumulativeXp: number }[] = [];
  const byDay = new Map<string, { count: number; xp: number }>();
  for (const event of events) { const previous = byDay.get(event.date) ?? { count: 0, xp: 0 }; byDay.set(event.date, { count: previous.count + 1, xp: previous.xp + event.xp }); }
  let cursor = DateTime.fromISO(from, { zone: 'UTC' });
  let cumulativeXp = openingXp;
  while (cursor.toISODate()! <= to) {
    const bucketStart = cursor.toISODate()!;
    const end = DateTime.min(cursor.endOf(interval === 'WEEK' ? 'week' : 'month').startOf('day'), DateTime.fromISO(to, { zone: 'UTC' }));
    let earnedXp = 0;
    while (cursor <= end) {
      const date = cursor.toISODate()!;
      const event = byDay.get(date);
      heatmap.push({ date, count: event?.count ?? 0 });
      earnedXp += event?.xp ?? 0;
      cursor = cursor.plus({ days: 1 });
    }
    cumulativeXp += earnedXp;
    xpSeries.push({ startDate: bucketStart, endDate: end.toISODate()!, earnedXp, cumulativeXp });
  }
  return { heatmap, xpSeries };
}
export function createStatisticsService(database: PrismaClient, clock: () => Date) {
  return {
    async history(userId: string, query: StatisticsQuery, kind: 'completions' | 'xp') {
      const user = await database.user.findUniqueOrThrow({ where: { id: userId }, select: { timeZone: true } });
      if (query.to > todayIn(clock(), user.timeZone)) throw invalid('History filters cannot include future dates');
      const rows = await database.completion.findMany({ where: completionFilter(userId, query), include: completionInclude, orderBy: [{ completedAt: 'desc' }, { id: 'desc' }] });
      const data = kind === 'completions' ? rows.map(completionDto) : rows.filter((row) => row.xpMovement).map((row) => {
        const item = completionDto(row);
        return { id: row.xpMovement!.id, amount: row.xpMovement!.amount, createdAt: row.xpMovement!.createdAt, completionId: row.id, activityId: item.activityId, activityTitle: item.activityTitle, category: item.category, localDate: item.localDate, timeZone: item.timeZone };
      }).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id));
      return paginate<(typeof data)[number]>(data, { page: query.page, pageSize: query.pageSize });
    },
    async dashboard(userId: string, query: StatisticsQuery) {
      return database.$transaction(async (tx) => {
        const { timeZone } = await lockUser(tx, userId);
        const now = clock();
        if (query.to > todayIn(now, timeZone)) throw invalid('Dashboard filters cannot include future dates');
        await materializeAll(tx, userId, now);
        const categoryWhere = query.categoryId ? { revision: { categoryId: query.categoryId } } : {};
        // A transaction uses one pg connection; execute its queries sequentially.
        const occurrences = await tx.occurrence.findMany({ where: { userId, scheduledDate: { gte: dbDate(query.from), lte: dbDate(query.to) }, ...categoryWhere }, include: occurrenceInclude });
        const completions = await tx.completion.findMany({ where: completionFilter(userId, query), include: completionInclude });
        const opening = await tx.xpMovement.aggregate({ where: { userId, completion: { localDate: { lt: dbDate(query.from) }, ...(query.categoryId ? { occurrenceUnit: { occurrence: categoryWhere } } : {}) } }, _sum: { amount: true } });
        const categories = await tx.category.findMany({ orderBy: { displayOrder: 'asc' } });
        const profile = await readSummary(tx, userId, now);
        // Closing event: latest completion in a fully completed period, using its recorded civil day.
        const reached = await tx.occurrence.findMany({ where: { userId, completedAt: { not: null }, ...categoryWhere }, include: { units: { include: { completion: true } } } });
        const states = occurrences.map((row) => occurrenceDto(row, now));
        const plannedOccurrences = states.length;
        const count = (status: string) => states.filter((row) => row.status === status).length;
        const completedOccurrences = count('COMPLETED');
        const percentage = (value: number) => plannedOccurrences ? value * 100 / plannedOccurrences : 0;
        const openingXp = opening._sum.amount ?? 0;
        const events = completions.map((row) => ({ date: civil(row.localDate), xp: row.xpMovement?.amount ?? 0 }));
        const goalsReached = reached.filter((row) => {
          const last = row.units.map((unit) => unit.completion).filter((event) => event !== null).sort((a, b) => b.completedAt.getTime() - a.completedAt.getTime())[0];
          return last && civil(last.localDate) >= query.from && civil(last.localDate) <= query.to;
        }).length;
        return {
          filters: { from: query.from, to: query.to, categoryId: query.categoryId ?? null, interval: query.interval }, asOf: now, timeZone, datePolicy: 'RECORDED_LOCAL_DATE', profile,
          planning: { plannedOccurrences, completedOccurrences, pendingOccurrences: count('PENDING'), overdueOccurrences: count('OVERDUE'), completionPercentage: percentage(completedOccurrences),
            byCategory: categories.filter((category) => !query.categoryId || category.id === query.categoryId).map((category) => ({ categoryId: category.id, categoryName: category.name, planned: states.filter((row) => row.revision.category.id === category.id).length, completed: states.filter((row) => row.revision.category.id === category.id && row.status === 'COMPLETED').length })),
            statusDistribution: ['COMPLETED', 'PENDING', 'OVERDUE'].map((status) => ({ status, count: count(status), percentage: percentage(count(status)) })),
          },
          earned: { goalsReached, completionCount: completions.length, xpEarned: events.reduce((sum, event) => sum + event.xp, 0), openingXp, ...buildTimeSeries(query.from, query.to, query.interval, events, openingXp) },
        };
      }, { timeout: 60000 });
    },
  };
}
