/**
 * Integration test for M9 against DATABASE_URL after `pnpm db:reset`: the district outlines for
 * preview images (slice B), and attendance with share links (slices E, F). Runs only on a local or
 * CI database, never on Supabase.
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url = process.env.DATABASE_URL;
const local = process.env.CI === 'true' || /localhost|127\.0\.0\.1/.test(url ?? '');
const tag = randomUUID().slice(0, 8);

interface View {
  counts: Record<string, number>;
  mine: string[];
  fromMyLinks: number;
}

describe.skipIf(!url || !local)('M9 in Postgres', () => {
  const db = new pg.Client({ connectionString: url });
  const square =
    'MULTIPOLYGON(((16.80 51.20, 16.81 51.20, 16.81 51.21, 16.80 51.21, 16.80 51.20)))';
  /** An event starting `startH` hours from the database's now, two hours long. */
  const event = (id: string, startH: number, hidden = false) =>
    db.query(
      `insert into events (id, region_id, title, category_ids, start_at, end_at, timezone, point,
         h3_r9, trust, hidden)
       values ($1, 'wroclaw', 'Test', '{music}', now() + make_interval(hours => $2),
         now() + make_interval(hours => $2 + 2), 'Europe/Warsaw', st_point(16.805, 51.205)::geography,
         'x', 'crawled', $3)`,
      [id, startH, hidden],
    );
  const set = async (
    ev: string,
    device: string,
    kind: string,
    on: boolean,
    token: string | null = null,
    until: string | null = null,
  ) =>
    (
      await db.query<{ r: View | null }>(
        `select attendance_set($1, $2, null, $3, $4, $5, 24, $6::timestamptz) as r`,
        [ev, device, kind, on, token, until],
      )
    ).rows[0]!.r;
  const get = async (ev: string, device: string) =>
    (await db.query<{ r: View }>(`select attendance_get($1, $2) as r`, [ev, device])).rows[0]!.r;
  const link = async (token: string, ev: string, device: string) =>
    (
      await db.query<{ r: boolean }>(`select share_link_create($1, $2, $3) as r`, [
        token,
        ev,
        device,
      ])
    ).rows[0]!.r;

  beforeAll(async () => {
    await db.connect();
    await db.query('set search_path = public, extensions');
    await db.query(
      `insert into districts (region_id, id, name, polygon) values ('wroclaw', $1, 'Testowo', st_geomfromtext($2, 4326))`,
      [`t-${tag}`, square],
    );
    await event(`${tag}-live`, -1);
    await event(`${tag}-soon`, 3);
    await event(`${tag}-over`, -5);
    await event(`${tag}-hidden`, 1, true);
  });
  afterAll(async () => {
    await db.query('delete from events where id like $1', [`${tag}-%`]);
    await db.query('delete from districts where id = $1', [`t-${tag}`]);
    await db.end();
  });

  it('gives the districts around a point as GeoJSON, marking the one it is in', async () => {
    const { rows } = await db.query<{
      r: { name: string; here: boolean; geometry: { type: string } }[];
    }>(`select district_outlines(51.205, 16.805, 1500) as r`);
    const mine = rows[0]!.r.find((d) => d.name === 'Testowo');
    // Simplifying can turn a one-part MultiPolygon into a Polygon; the image draws either.
    expect(mine).toMatchObject({ here: true });
    expect(['Polygon', 'MultiPolygon']).toContain(mine!.geometry.type);
    const far = await db.query<{ r: unknown[] }>(`select district_outlines(10, 10, 1500) as r`);
    expect(far.rows[0]!.r).toEqual([]);
  });

  it('keeps the outlines and attendance away from the public roles', async () => {
    await db.query('begin');
    try {
      await db.query('set local role anon');
      await expect(db.query(`select district_outlines(51.2, 16.8, 100)`)).rejects.toThrow(
        /permission denied/,
      );
    } finally {
      await db.query('rollback');
    }
    await db.query('begin');
    try {
      await db.query('set local role anon');
      await expect(db.query(`select attendance_get('x', 'y')`)).rejects.toThrow(
        /permission denied/,
      );
    } finally {
      await db.query('rollback');
    }
  });

  it('sets and clears "going", one per device', async () => {
    const ev = `${tag}-soon`;
    expect(await set(ev, 'd1', 'going', true)).toMatchObject({
      counts: { going: 1 },
      mine: ['going'],
    });
    // Again from the same device: still one.
    expect((await set(ev, 'd1', 'going', true))!.counts.going).toBe(1);
    expect((await set(ev, 'd2', 'going', true))!.counts.going).toBe(2);
    expect(await set(ev, 'd1', 'going', false)).toMatchObject({ counts: { going: 1 }, mine: [] });
  });

  it('refuses signals for ended, hidden and unknown events', async () => {
    expect(await set(`${tag}-over`, 'd1', 'going', true)).toBeNull();
    expect(await set(`${tag}-hidden`, 'd1', 'going', true)).toBeNull();
    expect(await set(`${tag}-nope`, 'd1', 'going', true)).toBeNull();
    expect(await link(`${tag}-t0`, `${tag}-hidden`, 'd1')).toBe(false);
  });

  it("counts people who came through a link for that link's maker only", async () => {
    const ev = `${tag}-live`;
    expect(await link(`${tag}-t1`, ev, 'sharer')).toBe(true);
    await set(ev, 'friend1', 'going', true, `${tag}-t1`);
    await set(ev, 'friend2', 'going', true, `${tag}-t1`);
    // The sharer's own "going" through their own link doesn't count; a token for another event
    // or an unknown one is ignored.
    await set(ev, 'sharer', 'going', true, `${tag}-t1`);
    await set(ev, 'friend3', 'going', true, 'unknown-token');
    expect((await get(ev, 'sharer')).fromMyLinks).toBe(2);
    expect((await get(ev, 'friend1')).fromMyLinks).toBe(0);
    // Leaving drops them from the count.
    await set(ev, 'friend2', 'going', false);
    expect((await get(ev, 'sharer')).fromMyLinks).toBe(1);
  });

  it('lets a short signal expire on its own window', async () => {
    const ev = `${tag}-live`;
    await set(ev, 'd9', 'looking', true, null, new Date(Date.now() - 60_000).toISOString());
    expect((await get(ev, 'd9')).mine).not.toContain('looking');
    await set(ev, 'd9', 'looking', true, null, new Date(Date.now() + 30 * 60_000).toISOString());
    expect((await get(ev, 'd9')).mine).toContain('looking');
  });
});
