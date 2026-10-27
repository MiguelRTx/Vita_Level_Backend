import type { Prisma, PrismaClient } from '../generated/prisma/client.ts';

export function withUser<T>(database: PrismaClient, userId: string, operation: (tx: Prisma.TransactionClient) => Promise<T>, options: { timeout?: number; maxWait?: number } = {}) {
  return database.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.user_id', ${userId}, true), set_config('app.auth_email', '', true)`;
    return operation(tx);
  }, { timeout: 30000, ...options });
}

export function withLoginEmail<T>(database: PrismaClient, email: string, operation: (tx: Prisma.TransactionClient) => Promise<T>) {
  return database.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.user_id', '', true), set_config('app.auth_email', ${email}, true)`;
    return operation(tx);
  });
}

export async function assertApplicationRole(database: PrismaClient) {
  const roles = await database.$queryRaw<{ unsafe: boolean }[]>`SELECT (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb) AS unsafe FROM pg_roles WHERE rolname = current_user`;
  const tables = await database.$queryRaw<{ enabled: boolean }[]>`SELECT bool_and(relrowsecurity AND relforcerowsecurity AND pg_get_userbyid(relowner) <> current_user) AS enabled FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname IN ('User','Session','Project','Activity','ActivityRevision','Occurrence','OccurrenceUnit','ProgressEntry','Completion','XpMovement','ActiveDay','UserBadge','UserReward')`;
  if (roles[0]?.unsafe !== false || tables[0]?.enabled !== true) throw new Error('Use the restricted application role and apply the RLS migration before starting the API.');
}
