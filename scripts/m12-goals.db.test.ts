/**
 * Integration test for M12 slice N against DATABASE_URL after `pnpm db:reset`: the district goal
 * counts a district's live events in a window, and anyone may ask it. Runs only on a local or CI
 * database, never on Supabase.
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url = process.env.DATABASE_URL;
const local = process.env.CI === 'true' || /localhost|127\.0\.0\.1/.test(url ?? '');
const tag = randomUUID().slice(0, 8);

describe.skipIf(!url || !local)('M12 district goals in Postgres', () => {
  const db = new pg.Client({ connectionString: url });
  // A small square district far from the real ones, so the seed's districts don't overlap it.
  const square =
    'MULTIPOLYGON(((16.80 51.20, 16.81 51.20, 16.81 51.21, 16.80 51.21, 16.80 51.20)))';
  const event = (id: string, lng: number, start: string, hidden = false) =>
    db.query(
      `insert into events (id, region_id, title, category_ids, start_at, end_at, timezone, point,
         h3_r9, trust, hidden)
       values ($1, 'wroclaw', 'Test', '{music}', $2::timestamptz, $2::timestamptz + interval '2 hours',
         'Europe/Warsaw', st_point($3, 51.205)::geography, 'x', 'crawled', $4)`,
      [id, start, lng, hidden],
    );
  const goal = (from: string, to: string) =>
    db.query<{ r: { name: string; count: number } | null }>(
      `select district_goal('wroclaw', 51.205, 16.805, $1, $2) as r`,
      [from, to],
    );

  beforeAll(async () => {
    await db.connect();
    await db.query('set search_path = public, extensions');
    await db.query(
      `insert into districts (region_id, id, name, polygon) values ('wroclaw', $1, 'Testowo', st_geomfromtext($2, 4326))`,
      [`t-${tag}`, square],
    );
    await event(`${tag}-in`, 16.805, '2026-10-31T10:00:00Z');
    await event(`${tag}-hidden`, 16.805, '2026-10-31T12:00:00Z', true);
    await event(`${tag}-later`, 16.805, '2026-11-07T10:00:00Z');
    await event(`${tag}-out`, 16.83, '2026-10-31T10:00:00Z');
  });
  afterAll(async () => {
    await db.query('delete from events where id like $1', [`${tag}-%`]);
    await db.query('delete from districts where id = $1', [`t-${tag}`]);
    await db.end();
  });

  it("counts the district's live events in the window, for anyone", async () => {
    const { rows } = await goal('2026-10-30T23:00:00Z', '2026-11-01T23:00:00Z');
    expect(rows[0]!.r).toMatchObject({ name: 'Testowo', count: 1 });
    await db.query('begin');
    try {
      await db.query('set local role anon');
      expect((await goal('2026-10-30T23:00:00Z', '2026-11-01T23:00:00Z')).rows[0]!.r).toMatchObject(
        { count: 1 },
      );
    } finally {
      await db.query('rollback');
    }
  });

  it('gives nothing outside every district', async () => {
    const { rows } = await db.query(
      `select district_goal('wroclaw', 51.5, 16.0, now(), now() + interval '1 day') as r`,
    );
    expect(rows[0]!.r).toBeNull();
  });
});
