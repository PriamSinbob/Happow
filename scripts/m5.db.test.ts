/**
 * Integration test for milestone 5 against DATABASE_URL (after `pnpm db:reset`): an event that a
 * complete-listing source (Ticketmaster) stops returning shows "possibly cancelled" after
 * `ingest.missedRunsToFlag` runs, reaches the moderation queue, and clears when it comes back.
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '@happow/core';
import { EventStore, runIngest } from '@happow/ingest';

const url = process.env.DATABASE_URL;
const config = loadConfig();
const fixture = (p: string) =>
  readFileSync(new URL(`../packages/ingest/test/fixtures/${p}`, import.meta.url), 'utf8');

const page0 = fixture('ticketmaster/page-0.json');
const page1 = fixture('ticketmaster/page-1.json');
// Mayday, on sale, 17:00 UTC; a later event stays listed, so its absence falls inside the
// checked window. (The 15:30 match in the fixture is already cancelled, so it is never checked.)
const GONE = 'Z698xZb_Z17a0kB';
/** Every listing from both pages except one, as a single page. */
const without = (() => {
  const p = JSON.parse(page0);
  const all = [...p._embedded.events, ...JSON.parse(page1)._embedded.events];
  p._embedded.events = all.filter((e: { id: string }) => e.id !== GONE);
  p.page.totalPages = 1;
  return JSON.stringify(p);
})();

function replay(bodies: string[]): typeof fetch {
  const queue = [...bodies];
  return (async () => new Response(queue.shift() ?? '{}')) as unknown as typeof fetch;
}

// Fixture events start on 2026-10-24; this keeps all of them inside the fetch window.
const now = new Date('2026-10-23T12:00:00Z');

describe.skipIf(!url)('milestone 5 in Postgres', () => {
  const db = new pg.Client({ connectionString: url });
  const store = new EventStore(db);
  const ingest = (bodies: string[]) =>
    runIngest({
      config,
      env: { TICKETMASTER_API_KEY: 'k' },
      store,
      now,
      sourceIds: ['ticketmaster'],
      force: true,
      fetch: replay(bodies),
      sleep: async () => {},
      log: () => {},
    });
  const flagOf = async () =>
    (
      await db.query<{ flag_reason: string | null; flag_count: number }>(
        `select e.flag_reason, e.flag_count from events e
         join event_sources es on es.event_id = e.id
         where es.source_id = 'ticketmaster' and es.external_id = $1`,
        [GONE],
      )
    ).rows[0];
  const cleanup = () =>
    db.query(`
      delete from events where id in (select event_id from event_sources
        where source_id = 'ticketmaster');
      delete from venues where id like 'ticketmaster:%';
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

  it('marks an event possibly cancelled after two missed runs and clears it when it returns', async () => {
    await ingest([page0, page1]);
    expect(await flagOf()).toMatchObject({ flag_reason: null });

    const [first] = await ingest([without]);
    expect(first).toMatchObject({ status: 'ok', missing: 0 });
    expect(await flagOf()).toMatchObject({ flag_reason: null });

    const [second] = await ingest([without]);
    expect(second).toMatchObject({ status: 'ok', missing: 1 });
    expect(await flagOf()).toEqual({ flag_reason: 'source_missing', flag_count: 0 });

    // moderation_queue() lists only events that haven't ended by the database's clock, and the
    // fixture's events are on 2026-10-24: keep this one upcoming so the check doesn't expire.
    await db.query(
      `update events e set end_at = now() + interval '1 day' from event_sources es
       where es.event_id = e.id and es.source_id = 'ticketmaster' and es.external_id = $1`,
      [GONE],
    );
    const queue = (
      await db.query<{ q: { reports: { reasons: object }[] } }>('select moderation_queue() as q')
    ).rows[0]!.q;
    expect(queue.reports.some((r) => 'source_missing' in r.reasons)).toBe(true);

    // An empty answer looks like an outage, not a mass cancellation: nothing changes.
    await ingest([JSON.stringify({ page: { totalPages: 0 } })]);
    expect(await flagOf()).toEqual({ flag_reason: 'source_missing', flag_count: 0 });

    await ingest([page0, page1]);
    expect(await flagOf()).toMatchObject({ flag_reason: null });
  });
});
