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

  describe('density_near', () => {
    const density = async (radius: number, search: number, categories: string[] | null = null) =>
      (
        await db.query(
          `select * from density_near($1, $2, $3, $4, now(), now() + interval '1 day', $5)`,
          [region.center.lat, region.center.lng, radius, search, categories],
        )
      ).rows;

    it('counts the same events as events_near, per density cell', async () => {
      const clusters = await density(500, 25000);
      const total = clusters.reduce((n, c) => n + c.event_count, 0);
      expect(total).toBe((await near(25000, 0, 24 * 60)).length);
      expect(new Set(clusters.map((c) => c.cell)).size).toBe(clusters.length);
      const counts = clusters.map((c) => c.event_count);
      expect(counts).toEqual([...counts].sort((a, b) => b - a));
    });

    it('describes only events beyond the user radius as outside', async () => {
      const clusters = await density(300, 25000);
      const outside = clusters.filter((c) => c.outside_count > 0);
      expect(outside.length).toBeGreaterThan(0);
      for (const c of outside) {
        expect(c.nearest_m).toBeGreaterThan(300);
        expect(typeof c.nearest_lat).toBe('number');
      }
      for (const c of clusters.filter((x) => x.outside_count === 0)) expect(c.nearest_m).toBeNull();
      const inside = (await near(300, 0, 24 * 60)).length;
      const outsideTotal = clusters.reduce((n, c) => n + c.outside_count, 0);
      expect(inside + outsideTotal).toBe((await near(25000, 0, 24 * 60)).length);
    });

    it('applies category filters and names the spot', async () => {
      const music = await density(500, 25000, ['music']);
      expect(music.length).toBeGreaterThan(0);
      expect(music.some((c) => typeof c.top_venue === 'string')).toBe(true);
      expect(music.reduce((n, c) => n + c.event_count, 0)).toBeLessThan(
        (await density(500, 25000)).reduce((n, c) => n + c.event_count, 0),
      );
    });

    it('seeded events carry a density cell and weather is gone', async () => {
      const { rows } = await db.query(
        `select count(*)::int as n from events where primary_source_id = 'seed' and density_cell is null`,
      );
      expect(rows[0].n).toBe(0);
      const t = await db.query(`select to_regclass('public.weather_cache') as t`);
      expect(t.rows[0].t).toBeNull();
    });

    it('is callable by the anon role', async () => {
      await db.query('begin; set local role anon');
      try {
        expect((await density(500, 5000)).length).toBeGreaterThan(0);
      } finally {
        await db.query('rollback');
      }
    });
  });
});
