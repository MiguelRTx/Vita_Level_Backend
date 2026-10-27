import { randomBytes } from 'node:crypto';
import { readFile, writeFile, rename, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parse } from 'dotenv';
import { Client } from 'pg';

const root = fileURLToPath(new URL('../', import.meta.url));
const files = ['.env', '.env.test'];
async function run() {
  const contents = await Promise.all(files.map((name) => readFile(join(root, name), 'utf8')));
  const settings = contents.map((content) => parse(content));
  const adminUrls = settings.map((item) => new URL(item.MIGRATION_DATABASE_URL ?? item.DATABASE_URL!));
  for (const [index, url] of adminUrls.entries()) {
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.port !== '55432' || url.pathname !== (index === 0 ? '/gamification' : '/gamification_test')) {
      throw new Error('This helper only configures the isolated local project cluster.');
    }
  }
  const current = new URL(settings[0]!.DATABASE_URL!);
  const candidate = decodeURIComponent(current.password);
  const password = current.username === 'ritmo_app' && /^[A-Za-z0-9_-]{32,}$/.test(candidate) ? candidate : randomBytes(36).toString('base64url');
  for (const [index, url] of adminUrls.entries()) {
    const result = spawnSync(process.execPath, [join(root, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy'], {
      cwd: root, env: { ...process.env, DATABASE_URL: url.toString(), MIGRATION_DATABASE_URL: url.toString() }, stdio: 'inherit',
    });
    if (result.status !== 0) throw new Error('Apply migrations with the migration account before continuing.');
    const admin = new Client({ connectionString: url.toString() });
    try {
      await admin.connect();
      await admin.query(`ALTER ROLE ritmo_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD '${password}'`);
    } finally { await admin.end(); }
    const runtime = new URL(url);
    runtime.username = 'ritmo_app'; runtime.password = password;
    let next = contents[index]!;
    const replace = (key: string, value: string) => {
      const pattern = new RegExp(`^${key}=.*$`, 'm');
      next = pattern.test(next) ? next.replace(pattern, `${key}=${value}`) : `${next.trimEnd()}\n${key}=${value}\n`;
    };
    replace('MIGRATION_DATABASE_URL', url.toString()); replace('DATABASE_URL', runtime.toString());
    replace('CORS_ORIGINS', 'http://localhost:5173');
    const file = join(root, files[index]!); const temporary = `${file}.setup-${process.pid}`;
    try { await writeFile(temporary, next, { mode: 0o600 }); await rename(temporary, file); }
    finally { await rm(temporary, { force: true }); }
    console.info(`Security configuration applied to ${url.pathname.slice(1)}; credentials remain in ignored environment files.`);
  }
}
run().catch(() => { console.error('Security setup failed. Check the local cluster and migration credentials.'); process.exitCode = 1; });
