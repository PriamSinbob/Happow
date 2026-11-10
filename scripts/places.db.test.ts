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
