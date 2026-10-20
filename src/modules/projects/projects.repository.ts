import type { Prisma } from '../../generated/prisma/client.ts';
import { civil, notFound, type Database } from '../../shared/domain.ts';

export const projectInclude = { tasks: { select: { id: true, occurrences: { select: { completedAt: true } } } } } satisfies Prisma.ProjectInclude;
export type ProjectRow = Prisma.ProjectGetPayload<{ include: typeof projectInclude }>;
export function projectDto(row: ProjectRow) {
  const completedTasks = row.tasks.filter((task) => task.occurrences.some((occurrence) => occurrence.completedAt)).length;
  const { tasks, userId: _userId, ...project } = row;
  return { ...project, startDate: civil(row.startDate), endDate: row.endDate ? civil(row.endDate) : null, totalTasks: tasks.length, completedTasks, progressPercentage: tasks.length ? completedTasks * 100 / tasks.length : 0 };
}
export async function findProject(database: Database, userId: string, id: string) {
  const row = await database.project.findFirst({ where: { id, userId }, include: projectInclude });
  if (!row) throw notFound();
  return row;
}
