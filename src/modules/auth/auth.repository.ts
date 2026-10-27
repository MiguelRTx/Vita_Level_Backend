import type { Prisma, PrismaClient } from '../../generated/prisma/client.ts';
import { randomUUID } from 'node:crypto';
import { withLoginEmail, withUser } from '../../database/user-context.ts';

export const publicUserSelect = {
  id: true, email: true, displayName: true, timeZone: true, createdAt: true,
} satisfies Prisma.UserSelect;

export function createAuthRepository(database: PrismaClient) {
  return {
    findByEmail: (email: string) => withLoginEmail(database, email, (tx) => tx.user.findUnique({ where: { email } })),
    async register(data: { email: string; displayName: string; passwordHash: string; timeZone: string }, expiresAt: Date) {
      const id = randomUUID();
      return withUser(database, id, async (transaction) => {
        const user = await transaction.user.create({ data: { ...data, id }, select: publicUserSelect });
        const session = await transaction.session.create({ data: { userId: user.id, expiresAt } });
        return { user, session };
      });
    },
    createSession: (userId: string, expiresAt: Date) => withUser(database, userId, (tx) => tx.session.create({ data: { userId, expiresAt } })),
    findSession: (id: string, userId: string) => withUser(database, userId, (tx) => tx.session.findUnique({ where: { id } })),
    revokeSession: (id: string, userId: string) => withUser(database, userId, (tx) => tx.session.updateMany({
      where: { id, userId, revokedAt: null }, data: { revokedAt: new Date() },
    })),
  };
}
