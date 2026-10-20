import { AppError } from '../../shared/errors/app-error.ts';
import type { HealthRepository } from './health.repository.ts';

export function createHealthService(repository: HealthRepository) {
  return {
    async checkReadiness() {
      try {
        await repository.ping();
        return { status: 'ok', database: 'up' } as const;
      } catch {
        throw new AppError(503, 'DATABASE_UNAVAILABLE', 'Database connection unavailable');
      }
    },
  };
}
