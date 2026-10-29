/**
 * Integration test for M12 slice I against DATABASE_URL after `pnpm db:reset`: a weekly repeat
 * stored as one submission per date, all or nothing against the quota, decided once by a
 * moderator, and shown per date on the account card. It writes to auth.users, so it runs only on
 * a local or CI database, never on Supabase.
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

describe.skipIf(!url || !local)('M12 series in Postgres', () => {
  const db = new pg.Client({ connectionString: url });
  const fn = async <T>(sql: string, args: unknown[] = []) =>
    (await db.query<{ r: T }>(`select ${sql} as r`, args)).rows[0]!.r;
  const region = getRegion(config).id;
  const source = config.sources.find((s) => s.adapter === 'user-submission')!.id;
  let user = '';

  const items = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: randomUUID(),
      form: {
        title: `Pchli targ ${tag}`,
        start: `2026-11-${String(7 + 7 * i).padStart(2, '0')}T10:00`,
      },
      normalized: {
        sourceId: source,
        event: { startAt: `2026-11-${String(7 + 7 * i).padStart(2, '0')}T09:00:00.000Z` },
      },
    }));
  const store = (series: string, list: ReturnType<typeof items>, max = 20) =>
    fn<{ id: string; eventId: string | null }[]>(
      'submit_series($1, $2, $3, $4, false, $5, $6, $7, false)',
      [series, JSON.stringify(list), `hash-${tag}`, region, user, MONTH, max],
    );
  const used = async () =>
    (await fn<{ events: number }>('usage_get($1, $2)', [user, MONTH])).events;

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

  it('stores one submission per date under one series, each counting once', async () => {
    const series = randomUUID();
    const list = items(3);
    const done = await store(series, list);
    expect(done.map((d) => d.id)).toEqual(list.map((i) => i.id));
    const rows = await db.query('select series_id, status from submissions where series_id = $1', [
      series,
    ]);
    expect(rows.rowCount).toBe(3);
    expect(rows.rows.every((r) => r.status === 'pending')).toBe(true);
    expect(await used()).toBe(3);
    const card = await fn<{ events: { seriesId: string | null }[] }>(
      'contributions_get($1, $2, 5)',
      [user, MONTH],
    );
    expect(card.events.filter((e) => e.seriesId === series)).toHaveLength(3);
  });

  it('stores nothing when the dates pass the monthly quota', async () => {
    const series = randomUUID();
    const before = await used();
    await expect(store(series, items(3), before + 2)).rejects.toMatchObject({ code: 'HQ001' });
    expect(
      (await db.query('select 1 from submissions where series_id = $1', [series])).rowCount,
    ).toBe(0);
    expect(await used()).toBe(before);
  });

  it('lets a moderator decide every pending date at once, earliest first, and only once', async () => {
    const series = randomUUID();
    const list = items(2).reverse();
    await store(series, list);
    const done = await fn<{ id: string; action: string }[]>(
      `moderate_series($1, 'reject', null, 'mod@example.org')`,
      [series],
    );
    expect(done.map((d) => d.id)).toEqual(list.map((i) => i.id).reverse());
    const queue = await fn<{ submissions: { series_id: string | null }[] }>('moderation_queue()');
    expect(queue.submissions.some((s) => s.series_id === series)).toBe(false);
    await expect(
      db.query(`select moderate_series($1, 'reject', null, 'x')`, [series]),
    ).rejects.toMatchObject({ code: 'P0001' });
    await expect(
      db.query(`select moderate_series($1, 'reject', null, 'x')`, [randomUUID()]),
    ).rejects.toMatchObject({ code: 'P0002' });
  });
});
