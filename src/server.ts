import 'dotenv/config';
import { ZodError } from 'zod';
import { createApp } from './app.ts';
import { authEnvironmentSchema, parseEnvironment } from './config/env.ts';
import { createApiRouter } from './routes.ts';
import { createDatabaseClient } from './database/client.ts';
import { createHealthRepository } from './modules/health/health.repository.ts';

function main() {
  const environment = parseEnvironment(process.env);
  const authentication = authEnvironmentSchema.parse(process.env);
  const database = createDatabaseClient(environment.DATABASE_URL);
  const app = createApp({
    healthRepository: createHealthRepository(database),
    corsOrigins: environment.CORS_ORIGINS,
    apiRouter: createApiRouter(database, authentication, environment.DEFAULT_TIME_ZONE, environment.XP_PER_COMPLETION),
  });
  const server = app.listen(environment.PORT, environment.HOST, () => {
    console.info(JSON.stringify({ event: 'server_started', port: environment.PORT, host: environment.HOST }));
  });

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    const timeout = setTimeout(() => process.exit(1), 10000);
    timeout.unref();
    server.close(() => {
      void database.$disconnect().then(() => {
        clearTimeout(timeout);
        process.exitCode = 0;
      }).catch(() => process.exit(1));
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  server.on('error', () => {
    console.error(JSON.stringify({ event: 'server_start_failed' }));
    void database.$disconnect().finally(() => process.exit(1));
  });
}

try {
  main();
} catch (error: unknown) {
  console.error(JSON.stringify({
    event: 'startup_failed',
    ...(error instanceof ZodError
      ? { invalidVariables: error.issues.map((issue) => issue.path.join('.')) }
      : {}),
  }));
  process.exitCode = 1;
}
