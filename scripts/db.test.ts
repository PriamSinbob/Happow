/** Integration test: runs against DATABASE_URL after `pnpm db:reset`. Skipped when no database is set. */
import 'dotenv/config';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getRegion, loadConfig } from '@happow/core';

const url = process.env.DATABASE_URL;
const config = loadConfig();
const region = getRegion(config);

describe.skipIf(!url)('events_near', () => {
  const db = new pg.Client({ connectionString: url });
  beforeAll(() => db.connect());
  afterAll(() => db.end());

  const near = async (radius: number, fromMin = 0, toMin = 0) =>
    (
      await db.query(
        `select * from events_near($1, $2, $3, now() + make_interval(mins => $4), now() + make_interval(mins => $5))`,
        [region.center.lat, region.center.lng, radius, fromMin, toMin],
      )
    ).rows;

  it('loaded the seed and config', async () => {
    const { rows } = await db.query(
      `select count(*)::int as n from events where primary_source_id = 'seed'`,
    );
    expect(rows[0].n).toBe(20);
    const cats = await db.query('select count(*)::int as n from categories');
    expect(cats.rows[0].n).toBe(config.categories.length);
  });

  it('returns only events within the radius, nearest first', async () => {
    const rows = await near(500, 0, 24 * 60);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.distance_m).toBeLessThanOrEqual(500);
    const d = rows.map((r) => Math.round(r.distance_m / 10));
    expect(d).toEqual([...d].sort((a, b) => a - b));
    expect(typeof rows[0].lat).toBe('number');
  });

  it('a wider radius includes more events', async () => {
    expect((await near(25000, 0, 24 * 60)).length).toBeGreaterThan(
      (await near(500, 0, 24 * 60)).length,
    );
  });

  it('filters by time window overlap ("now" = start ≤ now ≤ end)', async () => {
    const running = await near(25000, 0, 0);
    for (const r of running) {
      expect(new Date(r.start_at) <= new Date()).toBe(true);
      expect(new Date(r.end_at) >= new Date(Date.now() - 60_000)).toBe(true);
    }
    expect(running.length).toBeLessThan((await near(25000, 0, 24 * 60)).length);
  });

  it('is callable by the anon role (public read)', async () => {
    await db.query('begin; set local role anon');
    try {
      const { rows } = await db.query(
        `select count(*)::int as n from events_near($1, $2, 25000, now(), now() + interval '1 day')`,
        [region.center.lat, region.center.lng],
      );
      expect(rows[0].n).toBeGreaterThan(0);
      await expect(db.query(`delete from events`)).rejects.toThrow();
    } finally {
      await db.query('rollback');
    }
  });
});
