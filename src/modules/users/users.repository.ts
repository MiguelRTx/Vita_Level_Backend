import type { PrismaClient } from '../../generated/prisma/client.ts';
import { publicUserSelect } from '../auth/auth.repository.ts';

export function createUsersRepository(database: PrismaClient) {
  return {
    database,
    findProfile: (userId: string) => database.user.findUniqueOrThrow({ where: { id: userId }, select: publicUserSelect }),
    findBadges: (userId: string) => database.userBadge.findMany({
      where: { userId }, include: { badge: true }, orderBy: { earnedAt: 'desc' },
    }),
  };
}
