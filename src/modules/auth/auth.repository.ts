import type { Prisma, PrismaClient } from '../../generated/prisma/client.ts';

export const publicUserSelect = {
  id: true, email: true, displayName: true, timeZone: true, createdAt: true,
} satisfies Prisma.UserSelect;

export function createAuthRepository(database: PrismaClient) {
  return {
    findByEmail: (email: string) => database.user.findUnique({ where: { email } }),
    async register(data: { email: string; displayName: string; passwordHash: string; timeZone: string }, expiresAt: Date) {
      return database.$transaction(async (transaction) => {
        const user = await transaction.user.create({ data, select: publicUserSelect });
        const session = await transaction.session.create({ data: { userId: user.id, expiresAt } });
        return { user, session };
      });
    },
    createSession: (userId: string, expiresAt: Date) => database.session.create({ data: { userId, expiresAt } }),
    findSession: (id: string) => database.session.findUnique({ where: { id } }),
    revokeSession: (id: string, userId: string) => database.session.updateMany({
      where: { id, userId, revokedAt: null }, data: { revokedAt: new Date() },
    }),
  };
}
