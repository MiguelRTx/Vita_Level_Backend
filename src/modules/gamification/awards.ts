import type { Prisma, AchievementRule } from '../../generated/prisma/client.ts';
import { readSummary } from './summary.ts';

export async function unlockAchievements(tx: Prisma.TransactionClient, userId: string, now: Date) {
  const summary = await readSummary(tx, userId, now);
  const completions = await tx.completion.count({ where: { userId } });
  const categories = await tx.activityRevision.findMany({ where: { userId, occurrences: { some: { units: { some: { completion: { isNot: null } } } } } }, select: { categoryId: true }, distinct: ['categoryId'] });
  const badges = await tx.badge.findMany({ where: { users: { none: { userId } } } });
  const rewards = await tx.reward.findMany({ where: { users: { none: { userId } } } });
  const values: Record<AchievementRule, number> = { COMPLETION_COUNT: completions, CATEGORY_COUNT: categories.length, LEVEL_REACHED: summary.level, STREAK_DAYS: summary.bestStreak };
  const newBadges = badges.filter((badge) => values[badge.rule] >= badge.threshold);
  const newRewards = rewards.filter((reward) => values[reward.rule] >= reward.threshold);
  if (newBadges.length) await tx.userBadge.createMany({ data: newBadges.map((badge) => ({ userId, badgeId: badge.id, earnedAt: now })), skipDuplicates: true });
  if (newRewards.length) await tx.userReward.createMany({ data: newRewards.map((reward) => ({ userId, rewardId: reward.id, unlockedAt: now })), skipDuplicates: true });
  return { gamification: summary, newBadges: newBadges.map((badge) => ({ ...badge, earnedAt: now })), newRewards: newRewards.map((reward) => ({ ...reward, unlockedAt: now })) };
}
