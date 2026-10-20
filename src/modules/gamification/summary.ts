import { DateTime } from 'luxon';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.ts';
import { AppError } from '../../shared/errors/app-error.ts';

export function calculateLevel(totalXp: number, levels: { number: number; minTotalXp: number }[]) {
  const current = [...levels].reverse().find((level) => level.minTotalXp <= totalXp);
  if (!current) throw new AppError(503, 'CATALOG_NOT_READY', 'Run the database seed before using this feature');
  const next = levels.find((level) => level.number > current.number);
  const xpInLevel = totalXp - current.minTotalXp;
  const required = next ? next.minTotalXp - current.minTotalXp : null;
  return {
    totalXp, level: current.number, xpInLevel,
    xpRequiredForNextLevel: required,
    xpToNextLevel: next ? Math.max(0, next.minTotalXp - totalXp) : null,
    nextLevel: next?.number ?? null,
    levelProgress: required ? xpInLevel / required : 1,
  };
}

export function calculateStreak(dates: string[], today: string) {
  const sorted = [...new Set(dates)].filter((date) => date <= today).sort();
  let length = 0;
  let bestStreak = 0;
  let previous: string | undefined;
  for (const date of sorted) {
    const consecutive = previous && DateTime.fromISO(previous, { zone: 'UTC' }).plus({ days: 1 }).toISODate() === date;
    length = consecutive ? length + 1 : 1;
    bestStreak = Math.max(bestStreak, length);
    previous = date;
  }
  const yesterday = DateTime.fromISO(today, { zone: 'UTC' }).minus({ days: 1 }).toISODate();
  return { currentStreak: previous === today || previous === yesterday ? length : 0, bestStreak };
}

export async function readSummary(database: PrismaClient | Prisma.TransactionClient, userId: string, now = new Date()) {
  const user = await database.user.findUniqueOrThrow({ where: { id: userId }, select: { totalXp: true, timeZone: true } });
  const levels = await database.level.findMany({ orderBy: { number: 'asc' } });
  const days = await database.activeDay.findMany({ where: { userId }, orderBy: { localDate: 'asc' } });
  const today = DateTime.fromJSDate(now, { zone: user.timeZone }).toISODate()!;
  return {
    ...calculateLevel(user.totalXp, levels),
    ...calculateStreak(days.map((day) => day.localDate.toISOString().slice(0, 10)), today),
  };
}
