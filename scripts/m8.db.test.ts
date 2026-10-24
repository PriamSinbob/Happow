/**
 * Integration test for M8 against DATABASE_URL after `pnpm db:reset`. Slice A: the profile
 * trigger, row-level security, cascade on delete, staff roles and sign-in code requests. Slice B:
 * plan grants. Slice C: monthly usage and quotas.
 * It writes to auth.users, so it runs only on a local or CI database, never on Supabase.
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getRegion, loadConfig } from '@happow/core';

const url = process.env.DATABASE_URL;
const config = loadConfig();
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
    await db.query('delete from submissions where submitter_hash = $1', [`hash-${tag}`]);
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

  it('adds, lists and ends manual grants', async () => {
    const email = mail('grant');
    const id = await newUser(email);
    await expect(
      fn('grant_add($1, $2, null, null, $3)', [mail('nobody'), 'premium', mail('owner')]),
    ).rejects.toThrow(/no account/);
    const g = await fn<{ id: string }>('grant_add($1, $2, null, $3, $4)', [
      email.toUpperCase(),
      'premium',
      'tester',
      mail('Owner'),
    ]);
    expect(g).toMatchObject({ plan: 'premium', source: 'manual', endsAt: null, note: 'tester' });
    expect(await fn<unknown[]>('grants_active($1)', [id])).toHaveLength(1);
    const listed = (await fn<{ id: string }[]>('grants_list()')).find((r) => r.id === g.id);
    expect(listed).toMatchObject({ email, createdBy: mail('owner'), active: true });

    expect(await fn('grant_end($1)', [g.id])).toBe(true);
    expect(await fn<unknown[]>('grants_active($1)', [id])).toHaveLength(0);
    // Ending it again keeps the first end; an unknown grant is false.
    const endsAt = async () =>
      (await db.query('select ends_at from plan_grants where id = $1', [g.id])).rows[0];
    const ended = await endsAt();
    expect(await fn('grant_end($1)', [g.id])).toBe(true);
    expect(await endsAt()).toEqual(ended);
    expect(await fn('grant_end($1)', [randomUUID()])).toBe(false);
    await expect(fn('grant_add($1, $2, null, null, null)', [email, 'gold'])).rejects.toThrow();
  });

  it('applies a provider purchase once, however often it is sent', async () => {
    const id = await newUser(mail('buyer'));
    const other = await newUser(mail('other'));
    const ref = `sub-${tag}`;
    const apply = (user: string, ends: string) =>
      fn<{ id: string; endsAt: string }>('grant_apply($1, $2, $3, $4, $5, $6)', [
        user,
        'premium',
        'fake',
        ref,
        '2026-10-01T00:00:00Z',
        ends,
      ]);
    const first = await apply(id, '2099-11-01T00:00:00Z');
    const again = await apply(id, '2099-12-01T00:00:00Z');
    expect(again.id).toBe(first.id);
    expect(new Date(again.endsAt).toISOString()).toBe('2099-12-01T00:00:00.000Z');
    const rows = await db.query('select 1 from plan_grants where provider_ref = $1', [ref]);
    expect(rows.rowCount).toBe(1);
    await expect(apply(other, '2099-12-01T00:00:00Z')).rejects.toThrow(/another account/);
    // A refund ends it now: no longer active.
    await apply(id, new Date(Date.now() - 1000).toISOString());
    expect(await fn<unknown[]>('grants_active($1)', [id])).toHaveLength(0);
  });

  it('shows users only their own grants, exports them and deletes them with the user', async () => {
    const a = await newUser(mail('ga'));
    const b = await newUser(mail('gb'));
    await fn('grant_add($1, $2, null, null, null)', [mail('ga'), 'premium']);
    await fn('grant_add($1, $2, null, null, null)', [mail('gb'), 'premium']);
    await db.query('begin');
    try {
      await db.query('set local role authenticated');
      await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [a]);
      const rows = (await db.query<{ user_id: string }>('select user_id from plan_grants')).rows;
      expect(rows.map((r) => r.user_id)).toEqual([a]);
    } finally {
      await db.query('rollback');
    }
    // The functions are for the API (service role) only.
    await db.query('begin');
    try {
      await db.query('set local role authenticated');
      await expect(db.query('select grants_active($1)', [a])).rejects.toThrow(/permission denied/);
    } finally {
      await db.query('rollback');
    }
    const exported = await fn<{ grants: unknown[] }>('account_export($1)', [a]);
    expect(exported.grants).toEqual([expect.objectContaining({ plan: 'premium' })]);
    await db.query('delete from auth.users where id = $1', [b]);
    expect((await db.query('select 1 from plan_grants where user_id = $1', [b])).rowCount).toBe(0);
  });

  describe('monthly usage (slice C)', () => {
    const month = '2026-10-01';
    const region = getRegion(config).id;
    const source = config.sources.find((s) => s.adapter === 'user-submission')!.id;
    const submit = (user: string | null, max: number, title = 'Test') =>
      fn<string>('submit_event($1, $2, $3, false, $4, $5, $6)', [
        { id: randomUUID(), form: { title, url: null }, normalized: { sourceId: source } },
        `hash-${tag}`,
        region,
        user,
        user ? month : null,
        max,
      ]);
    const usage = (user: string, m = month) =>
      fn<{ events: number; autofills: number }>('usage_get($1, $2)', [user, m]);

    it('counts events up to the limit and stores nothing past it', async () => {
      const id = await newUser(mail('quota'));
      await submit(id, 2);
      await submit(id, 2);
      await expect(submit(id, 2)).rejects.toMatchObject({ code: 'HQ001' });
      expect(await usage(id)).toEqual({ events: 2, autofills: 0 });
      const stored = await db.query('select 1 from submissions where user_id = $1', [id]);
      expect(stored.rowCount).toBe(2);
      // A new month starts from zero; anonymous submissions count nothing.
      expect(await usage(id, '2026-11-01')).toEqual({ events: 0, autofills: 0 });
      await submit(null, 0);
    });

    it('counts nothing when the submission fails', async () => {
      const id = await newUser(mail('fail'));
      await expect(
        fn('submit_event($1, $2, $3, false, $4, $5, $6)', [
          { id: randomUUID(), form: {}, normalized: { sourceId: 'no-such-source' } },
          `hash-${tag}`,
          region,
          id,
          month,
          5,
        ]),
      ).rejects.toThrow();
      expect(await usage(id)).toEqual({ events: 0, autofills: 0 });
    });

    it('lets exactly the limit through when requests arrive at once', async () => {
      const id = await newUser(mail('race'));
      const clients = Array.from({ length: 6 }, () => new pg.Client({ connectionString: url }));
      await Promise.all(clients.map((c) => c.connect()));
      try {
        const results = await Promise.all(
          clients.map(
            async (c) =>
              (
                await c.query<{ r: boolean }>(
                  `select public.usage_take($1, $2, 'autofills', 3) as r`,
                  [id, month],
                )
              ).rows[0]!.r,
          ),
        );
        expect(results.filter(Boolean)).toHaveLength(3);
      } finally {
        await Promise.all(clients.map((c) => c.end()));
      }
      expect(await usage(id)).toEqual({ events: 0, autofills: 3 });
      expect(await fn('usage_take($1, $2, $3, 0)', [id, '2026-12-01', 'autofills'])).toBe(false);
      await expect(fn('usage_take($1, $2, $3, 5)', [id, month, 'logins'])).rejects.toThrow();
      await expect(fn('usage_take($1, $2, $3, 5)', [id, '2026-10-15', 'events'])).rejects.toThrow();
    });

    it('shows users their own usage only, exports it, and unlinks events on delete', async () => {
      const a = await newUser(mail('ua'));
      const b = await newUser(mail('ub'));
      const sid = await submit(a, 5, 'Koncert');
      await submit(b, 5);
      await db.query('begin');
      try {
        await db.query('set local role authenticated');
        await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [a]);
        const rows = (await db.query<{ user_id: string }>('select user_id from account_usage'))
          .rows;
        expect(rows.map((r) => r.user_id)).toEqual([a]);
      } finally {
        await db.query('rollback');
      }
      const exported = await fn<{ usage: unknown[]; submissions: unknown[] }>(
        'account_export($1)',
        [a],
      );
      expect(exported.usage).toEqual([{ month: '2026-10', events: 1, autofills: 0 }]);
      expect(exported.submissions).toEqual([
        expect.objectContaining({ id: sid, title: 'Koncert', status: 'pending' }),
      ]);
      await db.query('delete from auth.users where id = $1', [a]);
      const kept = await db.query('select user_id from submissions where id = $1', [sid]);
      expect(kept.rows).toEqual([{ user_id: null }]);
    });
  });
});
