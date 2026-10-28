/**
 * Integration test for M12 slice C1 against DATABASE_URL after `pnpm db:reset`: OSM venues,
 * links and pin moves, the website check's list and candidates, accepted sites and pausing.
 * Uses its own test region; runs only on a local or CI database, never on Supabase.
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EventStore, type OsmVenue } from '@happow/ingest';

const url = process.env.DATABASE_URL;
const local = process.env.CI === 'true' || /localhost|127\.0\.0\.1/.test(url ?? '');
const tag = randomUUID().slice(0, 8);
const region = `m12v-${tag}`;
const osm = (
  id: string,
  name: string,
  lat: number,
  lng: number,
  website: string | null,
): OsmVenue => ({
  osmId: `node/${tag}${id}`,
  name,
  kind: 'amenity=theatre',
  point: { lat, lng },
  address: null,
  website,
  openingHours: null,
  wheelchair: null,
  serviceTimes: null,
});

describe.skipIf(!url || !local)('M12 venues in Postgres', () => {
  const db = new pg.Client({ connectionString: url });
  const venues = () => new EventStore(db).venues();

  beforeAll(async () => {
    await db.connect();
    await db.query('set search_path = public, extensions');
    await db.query(
      `insert into regions (id, name, timezone, center, polygon)
       values ($1, '{"pl":"Test","en":"Test"}', 'Europe/Warsaw', st_point(1, 0.5)::geography,
         st_geogfromtext('POLYGON((0 0, 2 0, 2 1, 0 1, 0 0))'))`,
      [region],
    );
    await db.query(
      `insert into venues (id, name, point, h3_r9) values
         ($1, 'Teatr Testowy', st_point(0.5004, 0.5)::geography, 'x'),
         ($2, 'Gdzie indziej', st_point(5, 5)::geography, 'x')`,
      [`t:${tag}:a`, `t:${tag}:out`],
    );
  });

  afterAll(async () => {
    await db.query('delete from venues where id like $1', [`t:${tag}:%`]);
    await db.query('delete from regions where id = $1', [region]);
    await db.end();
  });

  it('stores OSM venues and lists only the venues events use inside the region', async () => {
    await venues().upsertOsmVenues(region, [
      osm('1', 'Teatr Testowy', 0.5, 0.5, 'https://teatr.example/'),
      osm('2', 'Teatr Testowy, Scena Mała', 0.5001, 0.5, 'https://teatr.example/'),
      osm('3', 'Klub', 0.7, 0.7, 'https://klub.example/'),
    ]);
    expect((await venues().osmVenues(region)).map((v) => v.name).sort()).toEqual([
      'Klub',
      'Teatr Testowy',
      'Teatr Testowy, Scena Mała',
    ]);
    expect((await venues().eventVenues(region)).map((v) => v.id)).toEqual([`t:${tag}:a`]);
  });

  it('links a venue, moves its pin once, logs the move and serves it to ingest', async () => {
    const link = {
      venueId: `t:${tag}:a`,
      osmId: `node/${tag}1`,
      similarity: 1,
      distanceM: 44,
      moveTo: { lat: 0.5, lng: 0.5 },
    };
    expect(await venues().applyLinks([link])).toBe(1);
    // The same point again is not a new move.
    expect(await venues().applyLinks([link])).toBe(0);
    const moves = await db.query('select osm_id, distance_m from venue_moves where venue_id = $1', [
      link.venueId,
    ]);
    expect(moves.rows).toEqual([{ osm_id: `node/${tag}1`, distance_m: 44 }]);
    expect((await venues().osmPins(region)).get(link.venueId)).toEqual({ lat: 0.5, lng: 0.5 });
  });

  it('checks each website once, and again only after the recheck time', async () => {
    const due = await venues().sitesToCheck(region, 10, 30);
    expect(due.map((s) => s.website).sort()).toEqual([
      'https://klub.example/',
      'https://teatr.example/',
    ]);
    const teatr = due.find((s) => s.website === 'https://teatr.example/')!;
    await venues().saveProbe(region, teatr, { status: 'none', candidates: [] });
    expect((await venues().sitesToCheck(region, 10, 30)).map((s) => s.website)).toEqual([
      'https://klub.example/',
    ]);
    // Both venues on that site count as checked.
    const checked = await db.query(
      `select count(*)::int n from osm_venues where region_id = $1 and website_checked_at is not null`,
      [region],
    );
    expect(checked.rows[0].n).toBe(2);
  });

  it('turns finds into candidates, serves only accepted ones and pauses a failing site', async () => {
    const klub = (await venues().sitesToCheck(region, 10, 30))[0]!;
    const feed = `https://klub.example/${tag}.ics`;
    const page = `https://klub.example/${tag}/wydarzenia/`;
    expect(
      await venues().saveProbe(region, klub, {
        status: 'found',
        candidates: [
          {
            url: feed,
            kind: 'ical',
            count: 5,
            sample: [{ title: 'Jam', start: '2026-11-03T20:00' }],
          },
          { url: page, kind: 'jsonld', count: 2, sample: [] },
        ],
      }),
    ).toBe(2);
    expect(await venues().siteTargets(region)).toEqual([]);

    await db.query(`update source_candidates set status = 'accepted' where url = $1`, [feed]);
    const [target] = await venues().siteTargets(region);
    expect(target).toMatchObject({
      url: feed,
      kind: 'ical',
      venueName: 'Klub',
      point: { lat: 0.7, lng: 0.7 },
    });

    expect(await venues().recordSiteResults([{ id: target!.id, error: 'HTTP 500' }], 3)).toBe(0);
    expect(await venues().recordSiteResults([{ id: target!.id, error: null }], 3)).toBe(0);
    for (const n of [1, 2])
      await venues().recordSiteResults([{ id: target!.id, error: `HTTP 500 #${n}` }], 3);
    expect(await venues().recordSiteResults([{ id: target!.id, error: 'HTTP 500 #3' }], 3)).toBe(1);
    expect(await venues().siteTargets(region)).toEqual([]);
    const row = await db.query(
      'select status, failures, last_error from source_candidates where id = $1',
      [target!.id],
    );
    expect(row.rows[0]).toEqual({ status: 'paused', failures: 3, last_error: 'HTTP 500 #3' });
    await db.query('delete from source_candidates where region_id = $1', [region]);
  });
});
