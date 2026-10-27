import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { createDatabaseClient } from '../src/database/client.ts';
import { assertApplicationRole, withLoginEmail, withUser } from '../src/database/user-context.ts';

if (process.env.NODE_ENV !== 'test' || !new URL(process.env.DATABASE_URL!).pathname.endsWith('_test')) throw new Error('Use the isolated test database.');
const admin = createDatabaseClient(process.env.MIGRATION_DATABASE_URL!);
const app = createDatabaseClient(process.env.DATABASE_URL!);
const ids = [randomUUID(), randomUUID()];
const emails = ids.map((id) => `${id}@example.test`);
let projectId: string;
before(async () => {
  for (const [index, id] of ids.entries()) await admin.user.create({ data: { id, email: emails[index]!, displayName: 'RLS fixture', passwordHash: 'fixture-only' } });
  const project = await admin.project.create({ data: { userId: ids[1]!, title: 'Private', startDate: new Date('2030-01-01') } }); projectId = project.id;
});
after(async () => {
  try { await admin.project.deleteMany({ where: { userId: { in: ids } } }); await admin.user.deleteMany({ where: { id: { in: ids } } }); }
  finally { await app.$disconnect(); await admin.$disconnect(); }
});
test('runtime role is neither privileged nor a table owner and all owned tables force RLS', async () => { await assertApplicationRole(app); await assert.rejects(assertApplicationRole(admin)); });
test('queries without identity cannot read private rows', async () => { assert.deepEqual(await app.user.findMany(), []); assert.deepEqual(await app.project.findMany(), []); });
test('raw and ORM queries cannot read or modify another owner even without application filters', async () => {
  await withUser(app, ids[0]!, async (tx) => {
    assert.equal(await tx.project.findUnique({ where: { id: projectId } }), null);
    assert.deepEqual(await tx.$queryRaw`SELECT * FROM "Project"`, []);
    assert.equal((await tx.project.updateMany({ where: { id: projectId }, data: { title: 'Attack' } })).count, 0);
    assert.equal((await tx.user.findMany()).length, 1);
  });
  assert.equal((await withUser(app, ids[1]!, (tx) => tx.project.findMany())).length, 1);
  await assert.rejects(withUser(app, ids[0]!, (tx) => tx.project.create({ data: { userId: ids[1]!, title: 'Forged owner', startDate: new Date('2030-01-01') } })));
});
test('login can read only the requested email and cannot override an authenticated identity', async () => {
  assert.equal((await withLoginEmail(app, emails[0]!, (tx) => tx.user.findMany())).length, 1);
  await withUser(app, ids[0]!, async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.auth_email', ${emails[1]!}, true)`;
    assert.equal(await tx.user.findUnique({ where: { id: ids[1]! } }), null);
  });
});
test('pooled connections retain no identity after concurrent transactions or rollback', async () => {
  await Promise.all(Array.from({ length: 16 }, (_, index) => withUser(app, ids[index % 2]!, async (tx) => {
    assert.deepEqual((await tx.user.findMany()).map((row) => row.id), [ids[index % 2]]);
  })));
  await assert.rejects(withUser(app, ids[0]!, async () => { throw new Error('rollback'); }));
  assert.deepEqual(await app.user.findMany(), []);
});
test('runtime cannot disable row security or assume the migration role', async () => {
  await assert.rejects(app.$executeRawUnsafe('ALTER TABLE "User" DISABLE ROW LEVEL SECURITY'));
  await assert.rejects(app.$executeRawUnsafe('SET ROLE gamification'));
});
test('SQL-looking text remains data when stored through the parameterized ORM', async () => {
  const text = "O'Connor'); DROP TABLE User; --";
  const project = await withUser(app, ids[0]!, (tx) => tx.project.create({ data: { userId: ids[0]!, title: text, startDate: new Date('2030-01-01') } }));
  assert.equal(project.title, text);
  assert.equal(await admin.user.count({ where: { id: { in: ids } } }), 2);
});
