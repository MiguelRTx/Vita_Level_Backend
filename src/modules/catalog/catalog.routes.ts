import { Router } from 'express';
import type { PrismaClient } from '../../generated/prisma/client.ts';
import { getIdentity } from '../auth/auth.middleware.ts';
import { withUser } from '../../database/user-context.ts';

export function createCatalogRouter(database: PrismaClient) {
  const router = Router();
  router.get('/categories', async (_request, response) => {
    response.json({ data: await database.category.findMany({ orderBy: { displayOrder: 'asc' } }) });
  });
  router.get('/badges', async (_request, response) => {
    const userId = getIdentity(response).userId;
    const badges = await withUser(database, userId, (tx) => tx.badge.findMany({ include: { users: { where: { userId }, select: { earnedAt: true } } }, orderBy: { code: 'asc' } }));
    response.json({ data: badges.map(({ users, ...badge }) => ({ ...badge, earnedAt: users[0]?.earnedAt ?? null })) });
  });
  router.get('/rewards', async (_request, response) => {
    const userId = getIdentity(response).userId;
    const rewards = await withUser(database, userId, (tx) => tx.reward.findMany({ include: { users: { where: { userId }, select: { unlockedAt: true } } }, orderBy: { code: 'asc' } }));
    response.json({ data: rewards.map(({ users, ...reward }) => ({ ...reward, unlockedAt: users[0]?.unlockedAt ?? null })) });
  });
  return router;
}
