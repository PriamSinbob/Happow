/**
 * Integration test for M12 slice O against DATABASE_URL after `pnpm db:reset`: coverage per
 * district and category, today and the week, the emptiest district first. Runs only on a local
 * or CI database, never on Supabase.
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url = process.env.DATABASE_URL;
const local = process.env.CI === 'true' || /localhost|127\.0\.0\.1/.test(url ?? '');
const tag = randomUUID().slice(0, 8);
// Thu 29 Oct 2026, noon in Warsaw.
const AT = '2026-10-29T11:00:00Z';

type Coverage = {
  now: { eventsToday: number };
  districts: {
    id: string;
    today: number;
    week: number;
    byCategory: Record<string, { today: number; week: number }>;
  }[];
  weeks: unknown[];
};

describe.skipIf(!url || !local)('M12 coverage in Postgres', () => {
  const db = new pg.Client({ connectionString: url });
  const square = (lng: number) =>
    `MULTIPOLYGON(((${lng} 51.30, ${lng + 0.01} 51.30, ${lng + 0.01} 51.31, ${lng} 51.31, ${lng} 51.30)))`;
  const event = (id: string, lng: number, start: string, cats: string[], hidden = false) =>
    db.query(
      `insert into events (id, region_id, title, category_ids, start_at, end_at, timezone, point,
         h3_r9, trust, hidden, created_at)
       values ($1, 'wroclaw', 'Test', $2, $3::timestamptz, $3::timestamptz + interval '2 hours',
         'Europe/Warsaw', st_point($4, 51.305)::geography, 'x', 'crawled', $5, '2026-10-01')`,
      [id, cats, start, lng, hidden],
    );

  beforeAll(async () => {
    await db.connect();
    await db.query('set search_path = public, extensions');
    for (const [id, lng] of [
      ['busy', 16.6],
      ['quiet', 16.62],
      ['empty', 16.64],
    ] as const)
      await db.query(
        `insert into districts (region_id, id, name, polygon)
         values ('wroclaw', $1, $2, st_geomfromtext($3, 4326))`,
        [`${tag}-${id}`, `${tag} ${id}`, square(lng)],
      );
    await event(`${tag}-1`, 16.605, '2026-10-29T17:00:00Z', ['music', 'kids']);
    await event(`${tag}-2`, 16.605, '2026-11-02T17:00:00Z', ['cinema']);
    await event(`${tag}-3`, 16.605, '2026-10-29T18:00:00Z', ['cinema'], true);
    await event(`${tag}-4`, 16.625, '2026-11-03T17:00:00Z', ['music']);
    // After the end of day 7: not in the week.
    await event(`${tag}-5`, 16.645, '2026-11-06T12:00:00Z', ['music']);
  });
  afterAll(async () => {
    await db.query('delete from events where id like $1', [`${tag}-%`]);
    await db.query('delete from districts where id like $1', [`${tag}-%`]);
    await db.end();
  });

  it('counts live events per district and category, today and the week, emptiest first', async () => {
    const { rows } = await db.query<{ r: Coverage }>(`select coverage('wroclaw', $1) as r`, [AT]);
    const c = rows[0]!.r;
    const mine = c.districts.filter((d) => d.id.startsWith(tag));
    expect(mine.map((d) => d.id)).toEqual([`${tag}-empty`, `${tag}-quiet`, `${tag}-busy`]);
    const busy = mine.find((d) => d.id === `${tag}-busy`)!;
    expect(busy).toMatchObject({ today: 1, week: 2 });
    expect(busy.byCategory).toEqual({
      music: { today: 1, week: 1 },
      kids: { today: 1, week: 1 },
      cinema: { today: 0, week: 1 },
    });
    expect(mine.find((d) => d.id === `${tag}-empty`)).toMatchObject({ week: 0, byCategory: {} });
    expect(c.now.eventsToday).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(c.weeks)).toBe(true);
  });

  it('is for the service role only, and refuses an unknown region', async () => {
    await expect(db.query(`select coverage('no-such-region', now())`)).rejects.toMatchObject({
      code: 'P0002',
    });
    await db.query('begin');
    try {
      await db.query('set local role authenticated');
      await expect(db.query(`select coverage('wroclaw', now())`)).rejects.toThrow(
        /permission denied/,
      );
    } finally {
      await db.query('rollback');
    }
  });
});
