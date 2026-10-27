import { z } from 'zod';
import { dateSchema, idSchema, paginationSchema, quantitySchema, rangeSchema } from '../../shared/domain.ts';
import { plainText } from '../../shared/validation.ts';

const fields = {
  title: plainText(120), description: plainText(2000, 0).nullable().optional(),
  categoryId: idSchema, targetQuantity: quantitySchema, unit: plainText(40),
  targetCount: z.number().int().min(1).max(20), endDate: dateSchema.nullable().optional(),
};
export const createActivitySchema = z.strictObject({ ...fields, targetCount: fields.targetCount.default(1), frequency: z.enum(['ONCE', 'DAILY', 'WEEKLY']), startDate: dateSchema, projectId: idSchema.nullable().optional() });
export const editActivitySchema = z.strictObject(fields).partial().refine((value) => Object.keys(value).length > 0, 'Provide at least one field');
export const activityQuerySchema = paginationSchema.extend({ categoryId: idSchema.optional(), projectId: idSchema.optional(), frequency: z.enum(['ONCE', 'DAILY', 'WEEKLY']).optional(), archived: z.enum(['true', 'false']).default('false') });
export const occurrenceQuerySchema = paginationSchema.extend({ from: dateSchema, to: dateSchema, status: z.enum(['PENDING', 'COMPLETED', 'OVERDUE']).optional() }).refine((value) => rangeSchema.safeParse(value).success, 'Invalid date range');
export type ActivityCreate = z.infer<typeof createActivitySchema>;
export type ActivityEdit = z.infer<typeof editActivitySchema>;
export type ActivityQuery = z.infer<typeof activityQuerySchema>;
export type OccurrenceQuery = z.infer<typeof occurrenceQuerySchema>;
