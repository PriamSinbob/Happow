/**
 * Integration test: ingestion against DATABASE_URL (after `pnpm db:reset`), replaying the adapter
 * fixtures. Cleans up after itself. Skipped when no database is set.
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getRegion, loadConfig } from '@happow/core';
import { EventStore, runIngest, type IngestOptions } from '@happow/ingest';

const url = process.env.DATABASE_URL;
const config = loadConfig();
const region = getRegion(config);
const fixture = (p: string) =>
  readFileSync(new URL(`../packages/ingest/test/fixtures/${p}`, import.meta.url), 'utf8');

function replay(files: string[]): typeof fetch {
  const queue = files.map(fixture);
  return (async () => new Response(queue.shift() ?? '{}')) as unknown as typeof fetch;
}

const env = {
  TICKETMASTER_API_KEY: 'k',
  MEETUP_CLIENT_KEY: 'c',
  MEETUP_MEMBER_ID: '1',
  MEETUP_SIGNING_KEY_ID: 'kid',
  MEETUP_PRIVATE_KEY: generateKeyPairSync('rsa', { modulusLength: 2048 })
    .privateKey.export({ type: 'pkcs8', format: 'pem' })
    .toString(),
};
const TM = ['ticketmaster/page-0.json', 'ticketmaster/page-1.json'];
const MU = ['meetup/token.json', 'meetup/page-0.json', 'meetup/page-1.json'];
// Fixture events happen on 2026-10-24 (local); query that whole day.
const day = { from: '2026-10-23T22:00:00Z', to: '2026-10-24T21:59:59Z' };

describe.skipIf(!url)('ingestion into Postgres', () => {
  const db = new pg.Client({ connectionString: url });
  const store = new EventStore(db);
  const ingest = (sourceId: string, files: string[], extra: Partial<IngestOptions> = {}) =>
    runIngest({
      config,
      env,
      store,
      sourceIds: [sourceId],
      force: true,
      fetch: replay(files),
      sleep: async () => {},
      log: () => {},
      ...extra,
    });
  const cleanup = () =>
    db.query(`
      delete from events where id in (select event_id from event_sources
        where source_id in ('ticketmaster', 'meetup'));
      delete from venues where id like 'ticketmaster:%' or id like 'meetup:%';
      delete from raw_payloads; delete from source_runs;`);

  beforeAll(async () => {
    await db.connect();
    await db.query('set search_path = public, extensions');
    await cleanup();
  });
  afterAll(async () => {
    await cleanup();
    await db.end();
  });

  const near = async (radius: number, categories: string[] | null = null, price = 'any') =>
    (
      await db.query(`select * from events_near($1, $2, $3, $4, $5, $6, $7)`, [
        region.center.lat,
        region.center.lng,
        radius,
        day.from,
        day.to,
        categories,
        price,
      ])
    ).rows;

  it('inserts new events and merges duplicate listings within a batch', async () => {
    const [s] = await ingest('ticketmaster', TM);
    expect(s).toMatchObject({ status: 'ok', fetched: 9, inserted: 5, merged: 1 });
    const { rows } = await db.query(
      `select e.id, e.end_estimated, e.end_at, count(es.*)::int as links from events e
       join event_sources es on es.event_id = e.id
       where e.title = 'Dawid Podsiadło' group by e.id`,
    );
    // One event, two Ticketmaster listings; the second contributed the real end time.
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'ticketmaster:Z698xZb_Z17a0kA',
      links: 2,
      end_estimated: false,
    });
    const raw = await db.query(
      `select count(*)::int as n from raw_payloads where source_id = 'ticketmaster'`,
    );
    expect(raw.rows[0].n).toBe(9); // every payload, including rejected ones, for re-parsing
    const cells = await db.query(
      `select count(*)::int as n from events where primary_source_id = 'ticketmaster' and density_cell is null`,
    );
    expect(cells.rows[0].n).toBe(0);
  });

  it('is idempotent: a second run updates instead of duplicating', async () => {
    const before = (await db.query('select count(*)::int as n from events')).rows[0].n;
    const [s] = await ingest('ticketmaster', TM);
    expect(s).toMatchObject({ inserted: 0, updated: 6, merged: 0 });
    expect((await db.query('select count(*)::int as n from events')).rows[0].n).toBe(before);
  });

  it('records runs and skips sources that are not due', async () => {
    const [s] = await ingest('ticketmaster', TM, { force: false });
    expect(s).toMatchObject({ status: 'skipped', reason: 'not due' });
    const runs = await db.query(
      `select status, stats from source_runs where source_id = 'ticketmaster'`,
    );
    expect(runs.rows.every((r) => r.status === 'ok')).toBe(true);
    expect(runs.rows[0].stats).toMatchObject({ fetched: 9 });
  });

  it('filters by category and price, and hides cancelled events', async () => {
    await ingest('meetup', MU);
    const all = await near(25000);
    expect(all.some((r) => r.title === 'Wrocław JS #87: Signals, Servers and Suspense')).toBe(true);
    expect(all.some((r) => r.status === 'cancelled')).toBe(false);

    const talks = await near(25000, ['talk']);
    expect(talks.length).toBeGreaterThan(0);
    for (const r of talks) expect(r.category_ids).toContain('talk');

    const several = await near(25000, ['talk', 'theatre']);
    expect(several.length).toBeGreaterThan(talks.length);

    const free = await near(25000, null, 'free');
    const paid = await near(25000, null, 'paid');
    for (const r of free) expect(r.is_free).toBe(true);
    for (const r of paid) expect(r.is_free).toBe(false);
    expect(free.length + paid.length).toBe(all.length);
  });

  it('returns detail fields by id to the anon role', async () => {
    await db.query('begin; set local role anon');
    try {
      const { rows } = await db.query(`select * from event_by_id($1, $2, $3)`, [
        'ticketmaster:Z698xZb_Z17a0kA',
        region.center.lat,
        region.center.lng,
      ]);
      expect(rows[0]).toMatchObject({
        title: 'Dawid Podsiadło',
        primary_source_id: 'ticketmaster',
        source_url: 'https://www.ticketmaster.pl/event/dawid-podsiadlo-bilety/36001',
        venue_name: 'Hala Stulecia',
      });
      expect(rows[0].distance_m).toBeGreaterThan(1000);
      await expect(db.query('select * from raw_payloads')).rejects.toThrow();
    } finally {
      await db.query('rollback');
    }
  });

  it('stops showing API events past their cache age', async () => {
    await db.query(
      `update events set stale_after = now() - interval '1 minute' where id = 'ticketmaster:Z698xZb_Z17a0kB'`,
    );
    expect((await near(25000)).some((r) => r.id === 'ticketmaster:Z698xZb_Z17a0kB')).toBe(false);
    const byId = await db.query(`select * from event_by_id('ticketmaster:Z698xZb_Z17a0kB')`);
    expect(byId.rows).toHaveLength(0);
  });
});
