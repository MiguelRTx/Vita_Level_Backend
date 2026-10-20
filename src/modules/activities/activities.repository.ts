import type { Prisma } from '../../generated/prisma/client.ts';
import type { Database } from '../../shared/domain.ts';
import { civil, notFound, todayIn } from '../../shared/domain.ts';

export const activityInclude = { revisions: { include: { category: true }, orderBy: { version: 'asc' as const } } } satisfies Prisma.ActivityInclude;
export const occurrenceInclude = { revision: { include: { category: true } }, units: { include: { completion: true }, orderBy: { position: 'asc' as const } } } satisfies Prisma.OccurrenceInclude;
export type ActivityRow = Prisma.ActivityGetPayload<{ include: typeof activityInclude }>;
export type OccurrenceRow = Prisma.OccurrenceGetPayload<{ include: typeof occurrenceInclude }>;
export type RevisionRow = ActivityRow['revisions'][number];
export function revisionDto(row: RevisionRow) {
  return { id: row.id, version: row.version, effectiveFrom: civil(row.effectiveFrom), title: row.title, description: row.description, category: row.category, targetQuantity: row.targetQuantity.toFixed(3), unit: row.unit, targetCount: row.targetCount, endDate: row.endDate ? civil(row.endDate) : null, xpPerCompletion: row.xpPerCompletion };
}
export function currentRevision(row: ActivityRow, date: string) {
  const effectiveDate = date < civil(row.startDate) ? civil(row.startDate) : date;
  return [...row.revisions].reverse().find((revision) => civil(revision.effectiveFrom) <= effectiveDate) ?? row.revisions[0]!;
}
export function activityDto(row: ActivityRow, now: Date) {
  const current = currentRevision(row, todayIn(now, row.scheduleTimeZone));
  const pending = row.revisions.find((revision) => revision.version > current.version);
  return { id: row.id, projectId: row.projectId, frequency: row.frequency, startDate: civil(row.startDate), scheduleTimeZone: row.scheduleTimeZone, archivedAt: row.archivedAt, createdAt: row.createdAt, updatedAt: row.updatedAt, currentRevision: revisionDto(current), pendingRevision: pending ? revisionDto(pending) : null };
}
export function occurrenceDto(row: OccurrenceRow, now: Date) {
  return {
    id: row.id, activityId: row.activityId, revision: revisionDto(row.revision), periodStartDate: civil(row.periodStartDate), scheduledDate: civil(row.scheduledDate), startsAt: row.startsAt, endsAt: row.endsAt, completedAt: row.completedAt,
    status: row.completedAt ? 'COMPLETED' : row.endsAt <= now ? 'OVERDUE' : 'PENDING',
    units: row.units.map((unit) => ({ id: unit.id, position: unit.position, progressQuantity: unit.progressQuantity.toFixed(3), targetQuantity: row.revision.targetQuantity.toFixed(3), remainingQuantity: row.revision.targetQuantity.minus(unit.progressQuantity).toFixed(3), completionId: unit.completion?.id ?? null, completedAt: unit.completion?.completedAt ?? null })),
  };
}
export async function findActivity(database: Database, userId: string, id: string) {
  const row = await database.activity.findFirst({ where: { id, userId }, include: activityInclude });
  if (!row) throw notFound();
  return row;
}
export async function findOccurrence(database: Database, userId: string, id: string) {
  const row = await database.occurrence.findFirst({ where: { id, userId }, include: occurrenceInclude });
  if (!row) throw notFound();
  return row;
}
