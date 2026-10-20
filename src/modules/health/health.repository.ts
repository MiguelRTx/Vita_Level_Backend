import type { PrismaClient } from '../../generated/prisma/client.ts';

export interface HealthRepository {
  ping(): Promise<void>;
}

export function createHealthRepository(database: PrismaClient): HealthRepository {
  return {
    async ping() {
      await database.$queryRaw`SELECT 1`;
    },
  };
}
