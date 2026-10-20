/**
 * Applies supabase/migrations/*.sql in order, tracking applied files in public.schema_migrations.
 * Works on plain Postgres (local, CI) and on Supabase via its direct connection string.
 *   pnpm db:migrate            apply pending migrations
 *   pnpm db:migrate --reset    drop and recreate the public schema first (local only!)
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withClient } from './db.js';

const dir = fileURLToPath(new URL('../supabase/migrations/', import.meta.url));

await withClient(async (db) => {
  if (process.argv.includes('--reset')) {
    if (process.env.CI !== 'true' && !/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? ''))
      throw new Error('--reset refuses to run against a non-local database');
    await db.query(`
      drop schema if exists public cascade; create schema public;
      drop schema if exists extensions cascade; create schema extensions;
      drop type if exists event_status, trust_level, submission_status, report_reason cascade;`);
    console.log('reset public schema');
  }
  await db.query('create schema if not exists extensions');
  await db.query(
    'create table if not exists public.schema_migrations (name text primary key, applied_at timestamptz not null default now())',
  );
  const applied = new Set(
    (await db.query<{ name: string }>('select name from public.schema_migrations')).rows.map(
      (r) => r.name,
    ),
  );
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(join(dir, file), 'utf8');
    await db.query('begin');
    try {
      await db.query(sql);
      await db.query('insert into public.schema_migrations (name) values ($1)', [file]);
      await db.query('commit');
      console.log(`applied ${file}`);
    } catch (err) {
      await db.query('rollback');
      throw new Error(`migration ${file} failed: ${(err as Error).message}`);
    }
  }
  console.log('migrations up to date');
});
