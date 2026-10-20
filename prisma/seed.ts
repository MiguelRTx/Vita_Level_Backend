import 'dotenv/config';
import { z } from 'zod';
import { createDatabaseClient } from '../src/database/client.ts';
import { seedCatalog } from './catalog.ts';

async function main() {
  const connectionString = z.url().parse(process.env.DATABASE_URL);
  const database = createDatabaseClient(connectionString);
  try {
    await seedCatalog(database);
    console.info('Seed completed: 4 categories, 50 levels, 5 badges and 3 rewards (existing rows preserved).');
  } finally {
    await database.$disconnect();
  }
}

main().catch(() => {
  console.error('Seed failed. Check DATABASE_URL, database availability and applied migrations.');
  process.exitCode = 1;
});
