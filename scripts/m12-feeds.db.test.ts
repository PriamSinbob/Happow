/**
 * Integration test for M12 slice L against DATABASE_URL after `pnpm db:reset`: account calendar
 * feeds (the limit, a stopped feed), importing each event once against the quota, the first
 * approval making later events follow the account's trust, and no premium days for imports. It
 * writes to auth.users, so it runs only on a local or CI database, never on Supabase.
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getRegion, loadConfig } from '@happow/core';

const url = process.env.DATABASE_URL;
const local = process.env.CI === 'true' || /localhost|127\.0\.0\.1/.test(url ?? '');
const tag = randomUUID().slice(0, 8);
const config = loadConfig();
const MONTH = '2026-11-01';

describe.skipIf(!url || !local)('M12 account feeds in Postgres', () => {
  const db = new pg.Client({ connectionString: url });
  const fn = async <T>(sql: string, args: unknown[] = []) =>
    (await db.query<{ r: T }>(`select ${sql} as r`, args)).rows[0]!.r;
  const region = getRegion(config).id;
  const source = config.sources.find((s) => s.adapter === 'user-submission')!.id;
  let user = '';

  const item = (title: string) => ({
    id: randomUUID(),
    form: { title },
    normalized: { sourceId: source },
  });
  const importOne = (feed: number, key: string, max = 20) =>
    fn<{ id: string; trusted: boolean } | null>('feed_import($1, $2, $3, $4, false, $5, $6, 5)', [
      feed,
      key,
      JSON.stringify(item(`Feed ${key}`)),
      `hash-${tag}`,
      MONTH,
      max,
    ]);

  beforeAll(async () => {
    await db.connect();
    await db.query('set search_path = public, extensions');
    user = (
      await db.query<{ id: string }>('insert into auth.users (email) values ($1) returning id', [
        `ala-${tag}@example.org`,
      ])
    ).rows[0]!.id;
  });
  afterAll(async () => {
    await db.query('delete from submissions where submitter_hash = $1', [`hash-${tag}`]);
    await db.query('delete from auth.users where email like $1', [`%-${tag}@example.org`]);
    await db.end();
  });

  it('adds feeds up to the limit, the same address once, and never a stopped one again', async () => {
    const a = await fn<{ id: number }>('feed_add($1, $2, $3, 2)', [
      user,
      'https://a.example/x.ics',
      region,
    ]);
    const again = await fn<{ id: number }>('feed_add($1, $2, $3, 2)', [
      user,
      'https://a.example/x.ics',
      region,
    ]);
    expect(again.id).toBe(a.id);
    await fn('feed_add($1, $2, $3, 2)', [user, 'https://b.example/y.ics', region]);
    await expect(
      db.query('select feed_add($1, $2, $3, 2)', [user, 'https://c.example/z.ics', region]),
    ).rejects.toMatchObject({ code: 'HQ002' });
    await fn(`feed_set_status($1, 'stopped', 'owner@example.org')`, [a.id]);
    await expect(
      db.query('select feed_add($1, $2, $3, 2)', [user, 'https://a.example/x.ics', region]),
    ).rejects.toMatchObject({ code: 'HQ003' });
    // A stopped feed is not the account's to remove, and isn't read.
    expect(await fn<boolean>('feed_remove($1, $2)', [user, a.id])).toBe(false);
    const due = await fn<{ id: number }[]>('feeds_due($1)', [region]);
    expect(due.some((f) => f.id === a.id)).toBe(false);
    expect(await importOne(a.id, 'k1')).toBeNull();
  });

  it('imports each event once, against the quota, and follows trust after the first approval', async () => {
    const f = await fn<{ id: number }>('feed_add($1, $2, $3, 5)', [
      user,
      `https://d.example/${tag}.ics`,
      region,
    ]);
    const first = await importOne(f.id, 'e1');
    expect(first).toMatchObject({ trusted: false });
    expect(await importOne(f.id, 'e1')).toBeNull();
    const used = (await fn<{ events: number }>('usage_get($1, $2)', [user, MONTH])).events;
    await expect(
      db.query('select feed_import($1, $2, $3, $4, false, $5, $6, 5)', [
        f.id,
        'e2',
        JSON.stringify(item('Over')),
        `hash-${tag}`,
        MONTH,
        used,
      ]),
    ).rejects.toMatchObject({ code: 'HQ001' });

    // A moderator approves the first: the feed is approved, and an imported event earns nothing.
    await db.query(
      `update submissions set status = 'approved', reviewed_at = now(), reviewed_by = 'mod@example.org'
       where id = $1`,
      [first!.id],
    );
    const feeds = await fn<{ id: number; approved: boolean; imported: number }[]>(
      'feeds_list($1)',
      [user],
    );
    expect(feeds.find((x) => x.id === f.id)).toMatchObject({ approved: true, imported: 1 });
    expect(
      await fn('contribution_award($1, null, 3, 30, $2, null)', [first!.id, MONTH]),
    ).toBeNull();
    // Not a trusted account yet: later events still go to moderation.
    expect(await importOne(f.id, 'e3')).toMatchObject({ trusted: false });
    await fn('feed_record($1, null, 2)', [f.id]);
    expect(
      (await fn<{ lastEvents: number }[]>('feeds_list($1)', [user])).find(
        (x) => x.lastEvents === 2,
      ),
    ).toBeTruthy();
  });
});
