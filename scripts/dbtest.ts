/** Shared setup for the `*.db.test.ts` integration tests (`pnpm test:db` after `pnpm db:reset`). */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';

export const url = process.env.DATABASE_URL;
/** Tests that write to auth.users run only on a local or CI database, never on Supabase. */
export const local = process.env.CI === 'true' || /localhost|127\.0\.0\.1/.test(url ?? '');
/** Unique per run, so test rows never collide with the seed or an earlier run. */
export const tag = randomUUID().slice(0, 8);

/** Calls one SQL expression and returns its value: `fn('profile_get($1)', [id])`. */
export const sqlFn =
  (db: pg.ClientBase) =>
  async <T>(sql: string, args: unknown[] = []) =>
    (await db.query<{ r: T }>(`select ${sql} as r`, args)).rows[0]!.r;
