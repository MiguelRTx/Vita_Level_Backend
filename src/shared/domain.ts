import { DateTime } from 'luxon';
import { z } from 'zod';
import type { Prisma, PrismaClient } from '../generated/prisma/client.ts';
import { AppError } from './errors/app-error.ts';

export type Database = PrismaClient | Prisma.TransactionClient;
export const civil = (date: Date) => date.toISOString().slice(0, 10);
export const dbDate = (date: string) => new Date(`${date}T00:00:00.000Z`);
export const todayIn = (now: Date, zone: string) => DateTime.fromJSDate(now, { zone }).toISODate()!;
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => DateTime.fromISO(value, { zone: 'UTC' }).isValid, 'Invalid calendar date');
export const idSchema = z.uuid();
export const quantitySchema = z.string().regex(/^(0|[1-9]\d{0,8})(\.\d{1,3})?$/).refine((value) => Number(value) > 0, 'Amount must be positive');
export const paginationSchema = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20) });
export const rangeSchema = z.object({ from: dateSchema, to: dateSchema }).refine(({ from, to }) => from <= to && DateTime.fromISO(to).diff(DateTime.fromISO(from), 'days').days < 366, 'Expected an ordered range of at most 366 days');
export const notFound = () => new AppError(404, 'NOT_FOUND', 'Resource not found');
export const invalid = (message: string) => new AppError(422, 'VALIDATION_ERROR', message);
export function page<T>(data: T[], totalItems: number, query: { page: number; pageSize: number }) {
  return { data, pagination: { ...query, totalItems, totalPages: Math.ceil(totalItems / query.pageSize) } };
}
export function paginate<T>(rows: T[], query: { page: number; pageSize: number }) {
  return page(rows.slice((query.page - 1) * query.pageSize, query.page * query.pageSize), rows.length, query);
}
// All writes for one account take this lock, including revisions, archives and awards.
export async function lockUser(database: Prisma.TransactionClient, userId: string) {
  await database.$queryRaw`SELECT id FROM "User" WHERE id = ${userId}::uuid FOR UPDATE`;
  return database.user.findUniqueOrThrow({ where: { id: userId }, select: { timeZone: true } });
}
