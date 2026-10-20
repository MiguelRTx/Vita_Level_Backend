import { z } from 'zod';
import type { PrismaClient } from '../../generated/prisma/client.ts';
import { civil, dateSchema, dbDate, invalid, lockUser, paginate, todayIn } from '../../shared/domain.ts';
import { AppError } from '../../shared/errors/app-error.ts';
import { activityDto, activityInclude } from '../activities/activities.repository.ts';
import { materializeActivity } from '../activities/recurrence.ts';
import { findProject, projectDto, projectInclude } from './projects.repository.ts';

const fields = { title: z.string().trim().min(1).max(120), description: z.string().trim().max(2000).nullable().optional(), endDate: dateSchema.nullable().optional() };
export const projectCreateSchema = z.strictObject({ ...fields, startDate: dateSchema });
export const projectEditSchema = z.strictObject(fields).partial().refine((value) => Object.keys(value).length > 0, 'Provide at least one field');
export function createProjectsService(database: PrismaClient, clock: () => Date) {
  return {
    async list(userId: string, query: { archived: string; page: number; pageSize: number }) {
      const rows = await database.project.findMany({ where: { userId, archivedAt: query.archived === 'true' ? { not: null } : null }, include: projectInclude, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
      return paginate(rows.map(projectDto), { page: query.page, pageSize: query.pageSize });
    },
    async get(userId: string, id: string) { return projectDto(await findProject(database, userId, id)); },
    async tasks(userId: string, id: string, query: { page: number; pageSize: number }) {
      await findProject(database, userId, id);
      const rows = await database.activity.findMany({ where: { userId, projectId: id }, include: activityInclude, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
      return paginate(rows.map((row) => activityDto(row, clock())), query);
    },
    async create(userId: string, input: z.infer<typeof projectCreateSchema>) {
      return database.$transaction(async (tx) => {
        const { timeZone } = await lockUser(tx, userId);
        if (input.startDate < todayIn(clock(), timeZone) || (input.endDate && input.endDate < input.startDate)) throw invalid('Invalid project dates');
        const row = await tx.project.create({ data: { userId, title: input.title, description: input.description ?? null, startDate: dbDate(input.startDate), endDate: input.endDate ? dbDate(input.endDate) : null }, include: projectInclude });
        return projectDto(row);
      });
    },
    async edit(userId: string, id: string, input: z.infer<typeof projectEditSchema>) {
      return database.$transaction(async (tx) => {
        await lockUser(tx, userId);
        const row = await findProject(tx, userId, id);
        if (row.archivedAt) throw new AppError(409, 'PROJECT_ARCHIVED', 'The project is archived');
        if (input.endDate) {
          if (input.endDate < civil(row.startDate)) throw invalid('End date precedes start date');
          // Check every snapshot, so shortening a project cannot exclude historical tasks.
          const outside = await tx.activityRevision.count({ where: { userId, activity: { projectId: id }, endDate: { gt: dbDate(input.endDate) } } });
          if (outside) throw invalid('The project end date would exclude existing tasks');
        }
        const updated = await tx.project.update({ where: { id }, data: {
          ...(input.title !== undefined ? { title: input.title } : {}), ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.endDate !== undefined ? { endDate: input.endDate ? dbDate(input.endDate) : null } : {}),
        }, include: projectInclude });
        return projectDto(updated);
      });
    },
    async archive(userId: string, id: string) {
      return database.$transaction(async (tx) => {
        await lockUser(tx, userId);
        const now = clock();
        const row = await findProject(tx, userId, id);
        if (!row.archivedAt) {
          const tasks = await tx.activity.findMany({ where: { userId, projectId: id, archivedAt: null }, include: activityInclude });
          for (const task of tasks) await materializeActivity(tx, task, now);
          await tx.activity.updateMany({ where: { userId, projectId: id, archivedAt: null }, data: { archivedAt: now } });
          await tx.project.update({ where: { id }, data: { archivedAt: now } });
        }
        return projectDto(await findProject(tx, userId, id));
      }, { timeout: 30000 });
    },
  };
}
