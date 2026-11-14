/**
 * Regular services are read from OSM once a year; services_roll_forward carries each one to the
 * same weekday and wall-clock time in later weeks, only adding what is missing, and never from
 * an occurrence that was hidden.
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { url } from './dbtest';

const SOURCE = 'worship-services';

describe.skipIf(!url)('services_roll_forward', () => {
  const db = new pg.Client({ connectionString: url });
  const cleanup = () => db.query(`delete from events where primary_source_id = $1`, [SOURCE]);
  /** One service tomorrow at this minute, as the ingest writes it. */
  const seed = (osm: string, hidden = false) =>
    db.query(
      `insert into events (id, region_id, title, category_ids, start_at, end_at, timezone, point,
         h3_r9, trust, primary_source_id, primary_external_id, hidden)
       select $1 || ':' || ext, 'wroclaw', 'Nabożeństwo', '{religious}', s, s + interval '1 hour',
         'Europe/Warsaw', st_point(17.03, 51.11)::geography, '891e2040d0fffff', 'crawled', $1,
         ext, $3
       from (select s, $2 || '|' || to_char(s at time zone 'Europe/Warsaw', 'YYYY-MM-DD"T"HH24:MI') as ext
             from (select date_trunc('minute', now()) + interval '1 day' as s) a) b`,
      [SOURCE, osm, hidden],
    );
  const roll = async () =>
    (await db.query<{ n: number }>('select services_roll_forward($1, 14) as n', [SOURCE])).rows[0]!
      .n;

  beforeAll(async () => {
    await db.connect();
    await db.query('set search_path = public, extensions');
    await cleanup();
  });
  afterAll(async () => {
    await cleanup();
    await db.end();
  });

  it('adds next week at the same local time, once, with its source link', async () => {
    await seed('node/1');
    expect(await roll()).toBe(1);
    expect(await roll()).toBe(0);
    const { rows } = await db.query<{ local: string; linked: boolean }>(
      `select to_char(start_at at time zone timezone, 'HH24:MI') as local,
         exists (select 1 from event_sources es where es.event_id = e.id) as linked
       from events e where primary_source_id = $1 order by start_at`,
      [SOURCE],
    );
    expect(rows).toHaveLength(2);
    expect(rows[1]!.local).toBe(rows[0]!.local);
    expect(rows[1]!.linked).toBe(true);
  });

  it('does not carry a hidden occurrence forward', async () => {
    await cleanup();
    await seed('node/2', true);
    expect(await roll()).toBe(0);
  });
});
