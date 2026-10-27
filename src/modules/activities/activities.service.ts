import { withUser } from '../../database/user-context.ts';
import { DateTime } from 'luxon';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.ts';
import { civil, dbDate, invalid, lockUser, paginate, todayIn } from '../../shared/domain.ts';
import { AppError } from '../../shared/errors/app-error.ts';
import { activityDto, activityInclude, currentRevision, findActivity, findOccurrence, occurrenceDto, occurrenceInclude } from './activities.repository.ts';
import { materializeActivity, periodBounds } from './recurrence.ts';
import type { ActivityCreate, ActivityEdit, ActivityQuery, OccurrenceQuery } from './activities.validation.ts';

async function validateTerms(tx: Prisma.TransactionClient, userId: string, input: ActivityCreate) {
  if (input.frequency !== 'WEEKLY' && input.targetCount !== 1) throw invalid('Only weekly activities can have multiple sessions');
  if (input.frequency === 'ONCE' && !input.endDate) throw invalid('A one-time activity needs an end date');
  if (input.endDate && input.endDate < input.startDate) throw invalid('End date must be on or after start date');
  const category = await tx.category.findUnique({ where: { id: input.categoryId } });
  if (!category) throw invalid('Unknown category');
  if (input.projectId) {
    const project = await tx.project.findFirst({ where: { id: input.projectId, userId, archivedAt: null } });
    if (!project) throw new AppError(404, 'NOT_FOUND', 'Project not found');
    if (input.frequency !== 'ONCE' || category.slug !== 'personal-projects') throw invalid('Project tasks must be one-time personal-project activities');
    if (input.startDate < civil(project.startDate) || (project.endDate && (!input.endDate || input.endDate > civil(project.endDate)))) throw invalid('Task dates must be inside the project dates');
  }
}
export function createActivitiesService(database: PrismaClient, xpPerCompletion: number, clock = () => new Date()) {
  return {
    async list(userId: string, query: ActivityQuery) {
      return withUser(database, userId, async (database) => {
      const now = clock();
      const rows = await database.activity.findMany({ where: { userId, archivedAt: query.archived === 'true' ? { not: null } : null, ...(query.frequency ? { frequency: query.frequency } : {}), ...(query.projectId ? { projectId: query.projectId } : {}) }, include: activityInclude, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
      const data = rows.map((row) => activityDto(row, now)).filter((row) => !query.categoryId || row.currentRevision.category.id === query.categoryId);
      return paginate(data, { page: query.page, pageSize: query.pageSize });
      });
    },
    async get(userId: string, id: string) { return withUser(database, userId, async (tx) => activityDto(await findActivity(tx, userId, id), clock())); },
    async create(userId: string, input: ActivityCreate) {
      return withUser(database, userId, async (tx) => {
        const { timeZone } = await lockUser(tx, userId);
        const now = clock();
        if (input.startDate < todayIn(now, timeZone)) throw invalid('Retroactive activities are not allowed');
        await validateTerms(tx, userId, input);
        const row = await tx.activity.create({ data: {
          userId, projectId: input.projectId ?? null, frequency: input.frequency, startDate: dbDate(input.startDate), scheduleTimeZone: timeZone,
          revisions: { create: { version: 1, effectiveFrom: dbDate(input.startDate), title: input.title, description: input.description ?? null, categoryId: input.categoryId, targetQuantity: input.targetQuantity, unit: input.unit, targetCount: input.targetCount, endDate: input.endDate ? dbDate(input.endDate) : null, xpPerCompletion } },
        }, include: activityInclude });
        await materializeActivity(tx, row, now);
        return activityDto(row, now);
      }, { timeout: 30000 });
    },
    async edit(userId: string, id: string, input: ActivityEdit) {
      return withUser(database, userId, async (tx) => {
        await lockUser(tx, userId);
        const now = clock();
        const row = await findActivity(tx, userId, id);
        const cannotEdit = () => new AppError(409, 'ACTIVITY_NOT_EDITABLE', 'The activity cannot be edited in its current state');
        if (row.archivedAt) throw cannotEdit();
        await materializeActivity(tx, row, now);
        const today = todayIn(now, row.scheduleTimeZone);
        const current = currentRevision(row, today);
        if (row.revisions.some((revision) => revision.version > current.version)) throw cannotEdit();
        const terms: ActivityCreate = { title: input.title ?? current.title, description: input.description !== undefined ? input.description : current.description, categoryId: input.categoryId ?? current.categoryId, targetQuantity: input.targetQuantity ?? current.targetQuantity.toFixed(3), unit: input.unit ?? current.unit, targetCount: input.targetCount ?? current.targetCount, endDate: input.endDate !== undefined ? input.endDate : current.endDate ? civil(current.endDate) : null, frequency: row.frequency, startDate: civil(row.startDate), projectId: row.projectId };
        await validateTerms(tx, userId, terms);
        let effectiveFrom = terms.startDate;
        if (row.frequency === 'ONCE') {
          const recorded = await tx.progressEntry.count({ where: { userId, occurrenceUnit: { occurrence: { activityId: id } } } });
          if (recorded || (current.endDate && today > civil(current.endDate))) throw cannotEdit();
        } else if (today >= terms.startDate) {
          effectiveFrom = DateTime.fromISO(today, { zone: 'UTC' }).startOf(row.frequency === 'WEEKLY' ? 'week' : 'day').plus(row.frequency === 'WEEKLY' ? { weeks: 1 } : { days: 1 }).toISODate()!;
        }
        if (terms.endDate && terms.endDate < (row.frequency === 'ONCE' ? today : effectiveFrom)) throw invalid('End date precedes the effective date of this edit');
        const revision = await tx.activityRevision.create({ data: { activityId: id, userId, version: current.version + 1, effectiveFrom: dbDate(effectiveFrom), title: terms.title, description: terms.description ?? null, categoryId: terms.categoryId, targetQuantity: terms.targetQuantity, unit: terms.unit, targetCount: terms.targetCount, endDate: terms.endDate ? dbDate(terms.endDate) : null, xpPerCompletion: current.xpPerCompletion } });
        if (row.frequency === 'ONCE') {
          const bounds = periodBounds('ONCE', terms.startDate, row.scheduleTimeZone, terms.startDate, terms.endDate!);
          await tx.occurrence.updateMany({ where: { activityId: id, userId }, data: { revisionId: revision.id, endsAt: bounds.endsAt } });
        }
        await tx.activity.update({ where: { id }, data: { updatedAt: now } });
        return activityDto(await findActivity(tx, userId, id), now);
      }, { timeout: 30000 });
    },
    async archive(userId: string, id: string) {
      return withUser(database, userId, async (tx) => {
        await lockUser(tx, userId);
        const now = clock();
        const row = await findActivity(tx, userId, id);
        if (!row.archivedAt) {
          await materializeActivity(tx, row, now);
          await tx.activity.update({ where: { id }, data: { archivedAt: now } });
        }
        return activityDto(await findActivity(tx, userId, id), now);
      }, { timeout: 30000 });
    },
    async occurrences(userId: string, id: string, query: OccurrenceQuery) {
      return withUser(database, userId, async (tx) => {
        await lockUser(tx, userId);
        const now = clock();
        await materializeActivity(tx, await findActivity(tx, userId, id), now);
        const rows = await tx.occurrence.findMany({ where: { userId, activityId: id, scheduledDate: { gte: dbDate(query.from), lte: dbDate(query.to) } }, include: occurrenceInclude, orderBy: [{ scheduledDate: 'desc' }, { id: 'desc' }] });
        const data = rows.map((row) => occurrenceDto(row, now)).filter((row) => !query.status || row.status === query.status);
        return paginate(data, { page: query.page, pageSize: query.pageSize });
      }, { timeout: 30000 });
    },
    async occurrence(userId: string, id: string) { return withUser(database, userId, async (tx) => occurrenceDto(await findOccurrence(tx, userId, id), clock())); },
  };
}
