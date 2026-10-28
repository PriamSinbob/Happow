/**
 * Integration test for M12 slice A against DATABASE_URL after `pnpm db:reset`: m12_metrics() and
 * metrics_save() on a test region of two square districts, measured on the day the clocks go
 * back (Sun 25 Oct 2026, a 25-hour day in Europe/Warsaw).
 * It writes to auth.users, so it runs only on a local or CI database, never on Supabase.
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url = process.env.DATABASE_URL;
const local = process.env.CI === 'true' || /localhost|127\.0\.0\.1/.test(url ?? '');
const tag = randomUUID().slice(0, 8);
const region = `m12-${tag}`;
// Midday on Sun 25 Oct 2026; the local day runs 24 Oct 22:00Z → 25 Oct 23:00Z, tonight from 17:00Z.
const at = '2026-10-25T12:00:00Z';
const square = (x: number) => `MULTIPOLYGON(((${x} 0, ${x + 1} 0, ${x + 1} 1, ${x} 1, ${x} 0)))`;

describe.skipIf(!url || !local)('M12 metrics in Postgres', () => {
  const db = new pg.Client({ connectionString: url });
  const metrics = async () =>
    (
      await db.query<{ m: Record<string, unknown> }>('select m12_metrics($1, $2, 18) m', [
        region,
        at,
      ])
    ).rows[0]!.m;

  const event = (
    id: string,
    [lng, lat]: [number, number],
    start: string,
    end: string,
    extra: { trust?: string; status?: string; created?: string; categories?: string[] } = {},
  ) =>
    db.query(
      `insert into events (id, region_id, title, category_ids, start_at, end_at, timezone, point,
         h3_r9, trust, status, created_at)
       values ($1, $2, $1, $3, $4, $5, 'Europe/Warsaw', st_point($6, $7)::geography, 'x', $8, $9, $10)`,
      [
        `${tag}-${id}`,
        region,
        extra.categories ?? ['music'],
        start,
        end,
        lng,
        lat,
        extra.trust ?? 'crawled',
        extra.status ?? 'scheduled',
        extra.created ?? '2026-10-01T00:00:00Z',
      ],
    );

  beforeAll(async () => {
    await db.connect();
    await db.query('set search_path = public, extensions');
    await db.query(
      `insert into regions (id, name, timezone, center, polygon)
       values ($1, '{"pl":"Test","en":"Test"}', 'Europe/Warsaw', st_point(1, 0.5)::geography,
         st_geogfromtext('POLYGON((0 0, 2 0, 2 1, 0 1, 0 0))'))`,
      [region],
    );
    for (const [id, x] of [
      ['d1', 0],
      ['d2', 1],
    ] as const)
      await db.query(
        `insert into districts (region_id, id, name, polygon) values ($1, $2, $2, st_geomfromtext($3, 4326))`,
        [region, id, square(x)],
      );

    const d1: [number, number] = [0.5, 0.5];
    const d2: [number, number] = [1.5, 0.5];
    // Tonight in d1: today, tonight, the week.
    await event('tonight', d1, '2026-10-25T17:30:00Z', '2026-10-25T19:00:00Z');
    // This morning in d2, already over: today only.
    await event('morning', d2, '2026-10-25T10:00:00Z', '2026-10-25T11:00:00Z');
    // Ends just before 18:00 local: today and the week, not tonight.
    await event('afternoon', d2, '2026-10-25T16:30:00Z', '2026-10-25T16:59:00Z', {
      categories: ['music', 'food'],
    });
    // 00:30–01:30 local on the 25th (still summer time): today.
    await event('after-midnight', d1, '2026-10-24T22:30:00Z', '2026-10-24T23:30:00Z');
    // 23:30–23:59 local on the 24th: not today.
    await event('day-before', d1, '2026-10-24T21:30:00Z', '2026-10-24T21:59:00Z');
    // Cancelled, and added after the measured moment: never counted.
    await event('cancelled', d2, '2026-10-25T18:00:00Z', '2026-10-25T19:00:00Z', {
      status: 'cancelled',
    });
    await event('later', d2, '2026-10-25T18:00:00Z', '2026-10-25T19:00:00Z', {
      created: '2026-10-25T13:00:00Z',
    });
    // Community, tomorrow: the week.
    await event('community', d2, '2026-10-26T18:00:00Z', '2026-10-26T19:00:00Z', {
      trust: 'community',
      categories: ['market'],
    });
    // The week ends at local midnight after day 7 (1 Nov 23:00Z).
    await event('day7', d1, '2026-11-01T22:30:00Z', '2026-11-01T23:30:00Z');
    await event('day8', d1, '2026-11-01T23:30:00Z', '2026-11-02T00:30:00Z');

    const users: string[] = [];
    for (const name of ['a', 'b', 'c'])
      users.push(
        (
          await db.query<{ id: string }>(
            'insert into auth.users (email) values ($1) returning id',
            [`${name}-${tag}@example.org`],
          )
        ).rows[0]!.id,
      );
    const submission = (user: string, created: string) =>
      db.query(
        `insert into submissions (submitter_hash, kind, user_id, region_id, created_at)
         values ($1, 'user', $2, $3, $4)`,
        [`hash-${tag}`, user, region, created],
      );
    await submission(users[0]!, '2026-10-23T12:00:00Z');
    await submission(users[0]!, '2026-10-24T12:00:00Z');
    await submission(users[1]!, '2026-10-15T12:00:00Z');
    await submission(users[2]!, '2026-10-26T12:00:00Z');
  });

  afterAll(async () => {
    await db.query('delete from submissions where submitter_hash = $1', [`hash-${tag}`]);
    await db.query('delete from auth.users where email like $1', [`%-${tag}@example.org`]);
    await db.query('delete from events where region_id = $1', [region]);
    await db.query('delete from regions where id = $1', [region]);
    await db.end();
  });

  it('counts today, the week and tonight on the region’s own clock', async () => {
    const m = await metrics();
    expect(m).toMatchObject({
      region,
      eventsToday: 4,
      events7d: 4,
      eventsTonight: 1,
      districts: 2,
      districtsTonight: 1,
    });
    expect(m.byCategory7d).toEqual({ music: 3, food: 1, market: 1 });
  });

  it('counts the community share and the accounts that added events', async () => {
    const m = await metrics();
    expect(m).toMatchObject({
      community7d: 1,
      communityShare: 0.25,
      accountsAdded7d: 1,
      accountsAddedTotal: 2,
    });
  });

  it('saves one row per week', async () => {
    const save = async (t: string) =>
      (await db.query<{ ok: boolean }>('select metrics_save($1, $2) ok', [region, t])).rows[0]!.ok;
    expect(await save(at)).toBe(true);
    expect(await save('2026-10-19T08:00:00Z')).toBe(false);
    const rows = (
      await db.query<{ week: string; events: number }>(
        `select to_char(week, 'YYYY-MM-DD') week, (metrics ->> 'events7d')::int events
         from metrics_weekly where region_id = $1`,
        [region],
      )
    ).rows;
    expect(rows).toEqual([{ week: '2026-10-19', events: 4 }]);
  });

  it('rejects an unknown region', async () => {
    await expect(db.query(`select m12_metrics('no-such-region', now())`)).rejects.toThrow(
      /unknown region/,
    );
  });
});
