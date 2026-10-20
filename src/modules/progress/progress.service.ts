import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '../../generated/prisma/client.ts';
import { dbDate, invalid, lockUser, notFound, page, todayIn } from '../../shared/domain.ts';
import { AppError } from '../../shared/errors/app-error.ts';
import { findOccurrence, occurrenceDto } from '../activities/activities.repository.ts';
import { readSummary } from '../gamification/summary.ts';
import { unlockAchievements } from '../gamification/awards.ts';
import { completionDto, completionInclude, progressDto } from './progress.repository.ts';

export function createProgressService(database: PrismaClient, clock = () => new Date()) {
  return {
    async list(userId: string, id: string, query: { page: number; pageSize: number }) {
      if (!await database.occurrenceUnit.findFirst({ where: { id, userId } })) throw notFound();
      const where = { userId, occurrenceUnitId: id };
      const [rows, count] = await Promise.all([database.progressEntry.findMany({ where, orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }), database.progressEntry.count({ where })]);
      return page(rows.map(progressDto), count, query);
    },
    async record(userId: string, id: string, amountText: string, key: string) {
      const amount = new Prisma.Decimal(amountText);
      const requestHash = createHash('sha256').update(JSON.stringify(['progress-v1', id, amount.toFixed(3)])).digest('hex');
      return database.$transaction(async (tx) => {
        const { timeZone } = await lockUser(tx, userId);
        // Read the clock after taking the lock; a queued request may cross midnight.
        const now = clock();
        const replay = await tx.progressEntry.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey: key } } });
        if (replay) {
          if (replay.requestHash !== requestHash) throw new AppError(409, 'IDEMPOTENCY_KEY_REUSED', 'This key belongs to another request');
          return { replayed: true, body: replay.responseBody };
        }
        const unit = await tx.occurrenceUnit.findFirst({ where: { id, userId }, include: { completion: true, occurrence: { include: { activity: true, revision: true } } } });
        if (!unit) throw notFound();
        const { occurrence } = unit;
        if (occurrence.activity.archivedAt) throw new AppError(409, 'ACTIVITY_ARCHIVED', 'The activity is archived');
        if (unit.completion) throw new AppError(409, 'UNIT_ALREADY_COMPLETED', 'This session is already completed');
        if (now < occurrence.startsAt || now >= occurrence.endsAt) throw new AppError(409, 'OCCURRENCE_CLOSED', 'Progress can only be recorded in the current period');
        const quantity = unit.progressQuantity.plus(amount);
        if (quantity.greaterThan(occurrence.revision.targetQuantity)) throw invalid('Amount exceeds the remaining quantity');
        const localDate = dbDate(todayIn(now, timeZone));
        await tx.occurrenceUnit.update({ where: { id }, data: { progressQuantity: quantity } });
        const entry = await tx.progressEntry.create({ data: { userId, occurrenceUnitId: id, idempotencyKey: key, requestHash, amount, recordedAt: now, localDate, timeZone, responseBody: {} } });
        let completion = null;
        let xpGranted = 0;
        let awards: Awaited<ReturnType<typeof unlockAchievements>>;
        if (quantity.equals(occurrence.revision.targetQuantity)) {
          xpGranted = occurrence.revision.xpPerCompletion;
          const event = await tx.completion.create({ data: { userId, occurrenceUnitId: id, completedAt: now, localDate, timeZone, xpMovement: { create: { amount: xpGranted, createdAt: now } } }, include: completionInclude });
          completion = completionDto(event);
          await tx.user.update({ where: { id: userId }, data: { totalXp: { increment: xpGranted } } });
          await tx.activeDay.upsert({ where: { userId_localDate: { userId, localDate } }, update: {}, create: { userId, localDate, createdAt: now } });
          const remaining = await tx.occurrenceUnit.count({ where: { occurrenceId: occurrence.id, completion: null } });
          if (!remaining) await tx.occurrence.update({ where: { id: occurrence.id }, data: { completedAt: now } });
          awards = await unlockAchievements(tx, userId, now);
        } else {
          awards = { gamification: await readSummary(tx, userId, now), newBadges: [], newRewards: [] };
        }
        const body = { data: { progressEntry: progressDto(entry), occurrence: occurrenceDto(await findOccurrence(tx, userId, occurrence.id), now), completion, xpGranted, ...awards } };
        // Persist exactly the JSON representation returned over HTTP, including UTC strings.
        const json = JSON.parse(JSON.stringify(body)) as Prisma.InputJsonValue;
        await tx.progressEntry.update({ where: { id: entry.id }, data: { responseBody: json } });
        return { replayed: false, body: json };
      }, { timeout: 30000, maxWait: 10000 });
    },
  };
}
