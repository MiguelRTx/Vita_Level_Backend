import type { Prisma } from '../../generated/prisma/client.ts';
import { civil } from '../../shared/domain.ts';

export const completionInclude = { xpMovement: true, occurrenceUnit: { include: { occurrence: { include: { revision: { include: { category: true } } } } } } } satisfies Prisma.CompletionInclude;
export type CompletionRow = Prisma.CompletionGetPayload<{ include: typeof completionInclude }>;
export function completionDto(row: CompletionRow) {
  const { occurrence } = row.occurrenceUnit;
  return { id: row.id, occurrenceUnitId: row.occurrenceUnitId, occurrenceId: occurrence.id, activityId: occurrence.activityId, activityTitle: occurrence.revision.title, category: occurrence.revision.category, position: row.occurrenceUnit.position, completedAt: row.completedAt, localDate: civil(row.localDate), timeZone: row.timeZone, xpAwarded: row.xpMovement?.amount ?? 0 };
}
export function progressDto(row: { id: string; occurrenceUnitId: string; amount: Prisma.Decimal; recordedAt: Date; localDate: Date; timeZone: string }) {
  return { id: row.id, occurrenceUnitId: row.occurrenceUnitId, amount: row.amount.toFixed(3), recordedAt: row.recordedAt, localDate: civil(row.localDate), timeZone: row.timeZone };
}
