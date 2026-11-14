/**
 * Places from OSM: the weekly replace (new, changed, gone, a cut-off answer) and the area read.
 * Uses its own test region; local or CI only.
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EventStore, type OsmVenue } from '@happow/ingest';
import { local, tag, url } from './dbtest';

const region = `m29p-${tag}`;
const place = (id: string, lat: number, lng: number, hours: string | null): OsmVenue => ({
  osmId: `node/${tag}p${id}`,
  name: `Place ${id}`,
  kind: 'amenity=pub',
  point: { lat, lng },
  address: null,
  website: null,
  openingHours: hours,
  wheelchair: null,
  serviceTimes: null,
});

describe.skipIf(!url || !local)('places in Postgres', () => {
  const db = new pg.Client({ connectionString: url });
  const store = () => new EventStore(db).venues();
  const area = async (radius: number) =>
    (await db.query('select * from places_area(0.5, 1, $1)', [radius])).rows.filter((r) =>
      r.id.startsWith(`node/${tag}p`),
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
  });

  afterAll(async () => {
    await db.query('delete from regions where id = $1', [region]);
    await db.end();
  });

  it('stores places and reads the ones with hours, nearest first', async () => {
    const all = [
      place('far', 0.52, 1, 'Mo-Su 10:00-22:00'),
      place('near', 0.5001, 1, 'Mo-Su 16:00-02:00'),
      place('nohours', 0.5002, 1, null),
      place('away', 0.9, 1.9, '24/7'),
    ];
    expect(await store().replacePlaces(region, all)).toEqual({ removed: 0, kept: false });
    const rows = await area(5000);
    expect(rows.map((r) => r.name)).toEqual(['Place near', 'Place far']);
    expect(rows[0]).toMatchObject({ kind: 'amenity=pub', opening_hours: 'Mo-Su 16:00-02:00' });
    expect(rows[0].lat).toBeCloseTo(0.5001, 4);
  });

  it('updates what changed and removes what OSM no longer lists', async () => {
    const next = [
      place('far', 0.52, 1, 'Mo-Su 12:00-20:00'),
      place('near', 0.5001, 1, 'Mo-Su 16:00-02:00'),
      place('new', 0.5003, 1, '24/7'),
    ];
    expect(await store().replacePlaces(region, next)).toEqual({ removed: 2, kept: false });
    const rows = await area(5000);
    expect(rows.map((r) => r.name)).toEqual(['Place near', 'Place new', 'Place far']);
    expect(rows[2].opening_hours).toBe('Mo-Su 12:00-20:00');
  });

  it('removes nothing when the answer is much shorter than what is stored', async () => {
    expect(await store().replacePlaces(region, [place('near', 0.5001, 1, '24/7')])).toEqual({
      removed: 0,
      kept: true,
    });
    expect((await area(5000)).length).toBe(3);
  });

  it('keeps a place someone added through the import, and applies corrections', async () => {
    const user = (
      await db.query(
        `insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id`,
        [`${tag}-places@example.org`],
      )
    ).rows[0].id;
    try {
      const add = (name: string, hours: string) =>
        db.query(
          `select place_add($1, $2, $3, 'amenity=pub', 0.5004, 1, null, null, $4, 50) as id`,
          [user, region, name, hours],
        );
      const added = (await add(`Mine ${tag}`, 'Mo-Su 10:00-20:00')).rows[0].id as string;
      expect(added.startsWith('user/')).toBe(true);
      // The same name at the same spot: the stored place gets the hours instead.
      expect((await add(`mine ${tag}`, 'Mo-Su 12:00-20:00')).rows[0].id).toBe(added);
      const mine = async () =>
        (await db.query('select * from places_area(0.5, 1, 5000)')).rows.find(
          (r) => r.id === added,
        );
      expect((await mine()).opening_hours).toBe('Mo-Su 12:00-20:00');

      // Without an account, from a photo: the hashed device is logged instead.
      const photo = (
        await db.query(
          `select place_add(null, $1, $2, 'amenity=cafe', 0.5006, 1, null, null,
            'Mo-Fr 08:00-16:00', 50, $3) as id`,
          [region, `Photo ${tag}`, `dev-${tag}`],
        )
      ).rows[0].id as string;
      expect(
        (await db.query('select user_id, device from place_log where place_id = $1', [photo])).rows,
      ).toEqual([{ user_id: null, device: `dev-${tag}` }]);

      // The weekly import neither updates nor removes it.
      await store().replacePlaces(region, [
        place('far', 0.52, 1, 'Mo-Su 12:00-20:00'),
        place('near', 0.5001, 1, 'Mo-Su 16:00-02:00'),
        place('new', 0.5003, 1, '24/7'),
      ]);
      expect(await mine()).toBeTruthy();

      // Corrected hours hold until OSM changes the value they replaced.
      const near = `node/${tag}pnear`;
      const read = async () => (await area(5000)).find((r) => r.id === near);
      await db.query(`select place_change($1, $2, p_hours => 'Mo-Su 18:00-23:00')`, [user, near]);
      expect((await read()).opening_hours).toBe('Mo-Su 18:00-23:00');
      await store().replacePlaces(region, [
        place('far', 0.52, 1, 'Mo-Su 12:00-20:00'),
        place('near', 0.5001, 1, 'Mo-Su 17:00-01:00'),
        place('new', 0.5003, 1, '24/7'),
      ]);
      expect((await read()).opening_hours).toBe('Mo-Su 17:00-01:00');

      // A private party that is on shows; one that is over does not.
      await db.query(
        `select place_change($1, $2, p_private => true, p_private_until => now() + interval '2 hours')`,
        [user, near],
      );
      expect((await read()).private_until).toBeTruthy();
      await db.query(`select place_change($1, $2, p_private => false)`, [user, near]);
      expect((await read()).private_until).toBeNull();

      // Closed for good: not served; every change is logged.
      await db.query(`select place_change($1, $2, p_closed => true)`, [user, near]);
      expect(await read()).toBeUndefined();
      const log = await db.query('select action from place_log where place_id = $1 order by id', [
        near,
      ]);
      expect(log.rows.map((r) => r.action)).toEqual(['hours', 'private', 'public', 'closed']);
      await expect(
        db.query(`select place_change($1, 'node/none', p_closed => true)`, [user]),
      ).rejects.toMatchObject({ code: 'P0002' });
    } finally {
      await db.query('delete from places where added_by = $1', [user]);
      await db.query('delete from places where name = $1', [`Photo ${tag}`]);
      await db.query('delete from auth.users where id = $1', [user]);
    }
  });

  it('is not readable directly by the anon role', async () => {
    await db.query('begin; set local role anon');
    try {
      await expect(db.query('select * from places_area(0.5, 1, 1000)')).rejects.toThrow();
      await expect(db.query('select * from places')).rejects.toThrow();
    } finally {
      await db.query('rollback');
    }
  });
});
