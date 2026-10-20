import { DateTime } from 'luxon';
import { AppError } from '../../shared/errors/app-error.ts';
import { readSummary } from '../gamification/summary.ts';
import { publicUserSelect } from '../auth/auth.repository.ts';
import { lockUser } from '../../shared/domain.ts';
import type { createUsersRepository } from './users.repository.ts';

export function createUsersService(repository: ReturnType<typeof createUsersRepository>, clock = () => new Date()) {
  async function getProfile(userId: string) {
    return repository.database.$transaction(async (tx) => {
      await lockUser(tx, userId);
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: publicUserSelect });
      const gamification = await readSummary(tx, userId, clock());
      const earnedBadges = await tx.userBadge.findMany({ where: { userId }, include: { badge: true }, orderBy: { earnedAt: 'desc' } });
      return { ...user, gamification, badges: earnedBadges.map(({ badge, earnedAt }) => ({ ...badge, earnedAt })) };
    }, { timeout: 30000 });
  }
  return {
    getProfile,
    async updateProfile(userId: string, patch: { displayName?: string | undefined; timeZone?: string | undefined }) {
      await repository.database.$transaction(async (transaction) => {
        await transaction.$queryRaw`SELECT id FROM "User" WHERE id = ${userId}::uuid FOR UPDATE`;
        const user = await transaction.user.findUniqueOrThrow({ where: { id: userId }, select: publicUserSelect });
        if (patch.timeZone && patch.timeZone !== user.timeZone) {
          const recent = await transaction.completion.findFirst({ where: { userId, completedAt: { gt: new Date(clock().getTime() - 48 * 3600000) } } });
          const lastDay = await transaction.activeDay.findFirst({ where: { userId }, orderBy: { localDate: 'desc' } });
          const today = DateTime.fromJSDate(clock(), { zone: patch.timeZone }).toISODate()!;
          if (recent || (lastDay && today <= lastDay.localDate.toISOString().slice(0, 10))) {
            throw new AppError(409, 'TIME_ZONE_CHANGE_BLOCKED', 'Wait 48 hours after your last completion before changing time zone');
          }
        }
        await transaction.user.update({ where: { id: userId }, data: {
          ...(patch.displayName === undefined ? {} : { displayName: patch.displayName }),
          ...(patch.timeZone === undefined ? {} : { timeZone: patch.timeZone }),
        } });
      });
      return getProfile(userId);
    },
  };
}
