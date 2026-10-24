/**
 * Integration test for M8 slice A (accounts) against DATABASE_URL after `pnpm db:reset`: the
 * profile trigger, row-level security, cascade on delete, staff roles and sign-in code requests.
 * It writes to auth.users, so it runs only on a local or CI database, never on Supabase.
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url = process.env.DATABASE_URL;
const local = process.env.CI === 'true' || /localhost|127\.0\.0\.1/.test(url ?? '');
const tag = randomUUID().slice(0, 8);
const mail = (name: string) => `${name}-${tag}@example.org`;

describe.skipIf(!url || !local)('M8 accounts in Postgres', () => {
  const db = new pg.Client({ connectionString: url });
  const newUser = async (email: string) =>
    (
      await db.query<{ id: string }>('insert into auth.users (email) values ($1) returning id', [
        email,
      ])
    ).rows[0]!.id;
  const fn = async <T>(sql: string, args: unknown[] = []) =>
    (await db.query<{ r: T }>(`select ${sql} as r`, args)).rows[0]!.r;

  beforeAll(async () => {
    await db.connect();
    await db.query('set search_path = public, extensions');
  });
  afterAll(async () => {
    await db.query('delete from auth.users where email like $1', [`%-${tag}@example.org`]);
    await db.query('delete from code_requests where email like $1', [`%-${tag}@example.org`]);
    await db.query('delete from moderators where email like $1', [`%-${tag}@example.org`]);
    await db.end();
  });

  it('creates a profile for every new user and removes it with the user', async () => {
    const id = await newUser(mail('ala'));
    expect((await db.query('select 1 from profiles where user_id = $1', [id])).rowCount).toBe(1);
    await db.query('delete from auth.users where id = $1', [id]);
    expect((await db.query('select 1 from profiles where user_id = $1', [id])).rowCount).toBe(0);
  });

  it('lets a signed-in user read only their own profile', async () => {
    const a = await newUser(mail('a'));
    const b = await newUser(mail('b'));
    await db.query('begin');
    try {
      await db.query('set local role authenticated');
      await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [a]);
      const rows = (await db.query<{ user_id: string }>('select user_id from profiles')).rows;
      expect(rows.map((r) => r.user_id)).toEqual([a]);
      expect(rows.map((r) => r.user_id)).not.toContain(b);
    } finally {
      await db.query('rollback');
    }
    // Anonymous visitors and signed-in users get no access at all to these tables (no grant).
    for (const [role, table] of [
      ['anon', 'profiles'],
      ['anon', 'code_requests'],
      ['authenticated', 'code_requests'],
    ]) {
      await db.query('begin');
      try {
        await db.query(`set local role ${role}`);
        await expect(db.query(`select 1 from ${table}`)).rejects.toThrow(/permission denied/);
      } finally {
        await db.query('rollback');
      }
    }
  });

  it('keeps the profile up to date and stamps the terms acceptance', async () => {
    const id = await newUser(mail('terms'));
    const p1 = await fn<Record<string, unknown>>('profile_update($1, $2, null)', [id, 'en']);
    expect(p1).toMatchObject({ locale: 'en', termsVersion: null, termsAcceptedAt: null });
    const p2 = await fn<Record<string, unknown>>('profile_update($1, null, $2)', [id, 'v1']);
    expect(p2).toMatchObject({ locale: 'en', termsVersion: 'v1' });
    expect(p2.termsAcceptedAt).not.toBeNull();
    const p3 = await fn<Record<string, unknown>>('profile_update($1, null, $2)', [id, 'v1']);
    expect(p3.termsAcceptedAt).toBe(p2.termsAcceptedAt);
    expect(await fn('account_export($1)', [id])).toMatchObject({ profile: { locale: 'en' } });
  });

  it('creates a missing profile on first read (users from before the migration)', async () => {
    const id = await newUser(mail('old'));
    await db.query('delete from profiles where user_id = $1', [id]);
    expect(await fn('profile_get($1)', [id])).toMatchObject({ locale: null });
    expect((await db.query('select 1 from profiles where user_id = $1', [id])).rowCount).toBe(1);
  });

  it('knows staff roles', async () => {
    await db.query(`insert into moderators (email, role) values ($1, 'admin'), ($2, default)`, [
      mail('owner'),
      mail('mod'),
    ]);
    expect(await fn('staff_role($1)', [mail('owner').toUpperCase()])).toBe('admin');
    expect(await fn('staff_role($1)', [mail('mod').toUpperCase()])).toBe('moderator');
    expect(await fn('staff_role($1)', [mail('nobody')])).toBeNull();
    await expect(
      db.query(`insert into moderators (email, role) values ($1, 'boss')`, [mail('x')]),
    ).rejects.toThrow();
  });

  it('keeps one open code request per email and purges old and used ones', async () => {
    const email = mail('code');
    await fn('request_code($1, $2, $3)', [email.toUpperCase(), 'pl', 'h1']);
    await fn('request_code($1, $2, $3)', [email, 'en', 'h2']);
    const open = await db.query<{ id: string; locale: string }>(
      'select id, locale from code_requests where email = $1',
      [email],
    );
    expect(open.rows).toHaveLength(1);
    expect(open.rows[0]!.locale).toBe('en');
    const id = open.rows[0]!.id;
    expect(await fn('code_request_get($1)', [id])).toMatchObject({ email, locale: 'en' });

    // Generated, then asked again: a new open request next to the generated one.
    expect(await fn('code_request_mark($1)', [id])).toBe(true);
    await fn('request_code($1, $2, $3)', [email, 'pl', 'h3']);
    expect((await db.query('select 1 from code_requests where email = $1', [email])).rowCount).toBe(
      2,
    );

    // The user signs in after the code was generated: that request goes, the open one stays.
    const user = await newUser(email);
    await db.query(
      `update auth.users set last_sign_in_at = now() + interval '1 minute' where id = $1`,
      [user],
    );
    const list =
      await fn<{ id: string; email: string; existingUser: boolean }[]>('code_requests_list(7)');
    const mine = list.filter((r) => r.email === email);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.id).not.toBe(id);
    expect(mine[0]!.existingUser).toBe(true);

    // Older than the retention: gone.
    await db.query(
      `update code_requests set created_at = now() - interval '8 days' where email = $1`,
      [email],
    );
    expect(
      (await fn<{ email: string }[]>('code_requests_list(7)')).some((r) => r.email === email),
    ).toBe(false);
  });

  it('forgets an account: code requests by email and the profile', async () => {
    const email = mail('gone');
    const id = await newUser(email);
    await fn('request_code($1, $2, $3)', [email, 'pl', 'h']);
    await fn('account_forget($1, $2)', [id, email.toUpperCase()]);
    expect((await db.query('select 1 from code_requests where email = $1', [email])).rowCount).toBe(
      0,
    );
    expect((await db.query('select 1 from profiles where user_id = $1', [id])).rowCount).toBe(0);
    const reqId = randomUUID();
    expect(await fn('code_request_delete($1)', [reqId])).toBe(false);
  });
});
