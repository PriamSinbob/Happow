/**
 * Integration test for milestone 4 against DATABASE_URL (after `pnpm db:reset`): crawled events,
 * the low-confidence queue, user submissions, reports and moderation. Cleans up after itself.
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getRegion, loadConfig } from '@happow/core';
import { MemoryCache, type ExtractedEvent, type Geocoder } from '@happow/extract';
import { EventStore, runIngest } from '@happow/ingest';
import { normalize } from '@happow/ingest/normalize';

const url = process.env.DATABASE_URL;
const config = loadConfig();
const region = getRegion(config);
const page = (name: string) =>
  readFileSync(new URL(`../packages/extract/test/fixtures/${name}`, import.meta.url), 'utf8');

function site(pages: Record<string, string>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const body = pages[String(input)];
    return body === undefined
      ? new Response('not found', { status: 404 })
      : new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  }) as typeof fetch;
}

const geocoder: Geocoder = {
  async geocode(q) {
    return q.street || q.venueName
      ? {
          point: { lat: 51.1079, lng: 17.0385 },
          precision: q.street ? 'address' : 'venue',
          label: 'x',
        }
      : null;
  },
};

describe.skipIf(!url)('milestone 4 in Postgres', () => {
  const db = new pg.Client({ connectionString: url });
  const store = new EventStore(db);
  const base = {
    config,
    env: { ANTHROPIC_API_KEY: 'k' },
    store,
    force: true,
    sleep: async () => {},
    log: () => {},
    geocoder,
  };
  const as = async <T>(role: string, fn: () => Promise<T>): Promise<T> => {
    await db.query(`begin; set local role ${role}`);
    try {
      return await fn();
    } finally {
      await db.query('rollback');
    }
  };
  const cleanup = () =>
    db.query(`
      delete from reports; delete from submissions; delete from rate_limits;
      delete from extraction_cache; delete from geocode_cache; delete from moderators;
      delete from events where id in (select event_id from event_sources
        where source_id in ('ebilet', 'nfm', 'submissions'));
      delete from venues where id like 'ebilet:%' or id like 'nfm:%' or id like 'submissions:%';
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

  it('stores crawled events as facts with a crawled trust level', async () => {
    const [s] = await runIngest({
      ...base,
      sourceIds: ['ebilet'],
      fetch: site({
        'https://www.ebilet.pl/robots.txt': page('ebilet-robots.txt'),
        'https://www.ebilet.pl/miasto/wroclaw': page('ebilet-listing.html'),
        'https://www.ebilet.pl/muzyka/hard-heavy/metallica-symfonicznie':
          page('ebilet-event-1.html'),
        'https://www.ebilet.pl/muzyka/rock/pidzama-porno': page('ebilet-event-2.html'),
      }),
    });
    expect(s).toMatchObject({ status: 'ok', queued: 0 });
    expect(s!.inserted).toBe(2);
    const { rows } = await db.query(
      `select trust, description, image_url, verified from events where primary_source_id = 'ebilet'`,
    );
    expect(
      rows.every((r) => r.trust === 'crawled' && r.description === null && r.image_url === null),
    ).toBe(true);
    expect(rows.every((r) => r.verified)).toBe(true);
  });

  describe('low-confidence extractions', () => {
    const unsure: ExtractedEvent = {
      title: 'Koncert niepewny',
      description: null,
      start: '2026-11-22T19:00',
      end: null,
      venueName: 'NFM',
      address: { street: 'plac Wolności 1', postalCode: '50-071', city: 'Wrocław', country: null },
      point: null,
      isFree: null,
      priceMin: null,
      priceMax: null,
      currency: null,
      url: null,
      ticketUrl: null,
      imageUrl: null,
      status: 'scheduled',
      ageMin: null,
      family: null,
      entry: null,
      online: false,
      categoryHints: [],
      categoryIds: ['music'],
      method: 'llm',
      confidence: 0.5,
    };
    const crawl = () =>
      runIngest({
        ...base,
        now: new Date('2026-10-20T22:40:00Z'),
        sourceIds: ['nfm'],
        fetch: site({
          'https://www.nfm.wroclaw.pl/component/nfmcalendar': page('nfm-event.html'),
        }),
        extractor: { id: 'fake:1', extract: async () => [unsure] },
        extractionCache: new MemoryCache(),
      });

    it('go to the moderation queue, once, instead of the map', async () => {
      const [first] = await crawl();
      expect(first).toMatchObject({ status: 'ok', queued: 1, inserted: 0 });
      await crawl();
      const { rows } = await db.query(`select * from submissions where kind = 'crawl'`);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ source_id: 'nfm', status: 'pending', region_id: 'wroclaw' });
      expect(rows[0].confidence).toBeCloseTo(0.5, 5);
    });

    it('appear on the map once approved, and later crawls update them in place', async () => {
      const { rows } = await db.query(`select id from submissions where kind = 'crawl'`);
      const res = await as(
        'service_role',
        async () =>
          (
            await db.query(
              `select moderate_submission($1, 'approve', null, 'mod@example.org') as r`,
              [rows[0].id],
            )
          ).rows[0].r,
      );
      expect(res.eventId).toMatch(/^nfm:/);
      // as() rolled back: approve for real now.
      await db.query(`select moderate_submission($1, 'approve', 'ok', 'mod@example.org')`, [
        rows[0].id,
      ]);
      const ev = await db.query(`select * from events_public where id = $1`, [res.eventId]);
      expect(ev.rows[0]).toMatchObject({ title: 'Koncert niepewny', verified: true });
      const [again] = await crawl();
      expect(again).toMatchObject({ queued: 0, updated: 1 });
    });
  });

  describe('user submissions, reports and moderation', () => {
    const submission = (title: string) => {
      const id = randomUUID();
      const source = config.sources.find((s) => s.id === 'submissions')!;
      const res = normalize(
        {
          externalId: id,
          sourceUrl: null,
          title,
          description: 'Wyprzedaż rzeczy z piwnicy',
          startAt: new Date(Date.now() - 30 * 60_000).toISOString(),
          endAt: new Date(Date.now() + 3 * 3_600_000).toISOString(),
          categoryLabels: [],
          categoryIds: ['garage-sale'],
          venue: {
            externalId: id,
            name: 'Podwórko',
            address: 'ul. Ruska 46, Wrocław',
            point: region.center,
            website: null,
          },
          point: region.center,
          isFree: true,
          priceMin: 0,
          priceMax: 0,
          currency: null,
          rules: {},
          ageMin: 0,
          family: true,
          entry: 'open',
          officialUrl: null,
          ticketUrl: null,
          imageUrl: null,
          status: 'scheduled',
        },
        {
          source,
          region,
          categories: config.categories,
          h3Resolution: config.app.h3.eventResolution,
          densityResolution: config.app.h3.densityResolution,
          descriptionMaxChars: 600,
          now: new Date(),
        },
      );
      if (!res.ok) throw new Error(res.reason);
      return { id, form: { title, url: null }, normalized: res.value };
    };
    const near = async () =>
      (
        await db.query(
          `select id, verified, flag_reason, flag_count, flag_at, entry, age_min, family
           from events_near($1, $2, 300, now(), now() + interval '1 hour')`,
          [region.center.lat, region.center.lng],
        )
      ).rows;
    let published: string;

    it('publishes a submission at once as unverified (config), never callable by anon', async () => {
      const p = submission('Wyprzedaż garażowa na Ruskiej');
      await expect(
        as('anon', () => db.query(`select submit_event($1, 'dev', 'wroclaw', true)`, [p])),
      ).rejects.toThrow(/permission denied/);
      await db.query(`select submit_event($1, 'device-hash-1', 'wroclaw', $2)`, [
        p,
        config.app.submissions.publishBeforeModeration,
      ]);
      published = `submissions:${p.id}`;
      expect((await near()).find((e) => e.id === published)).toMatchObject({
        verified: false,
        entry: 'open',
        age_min: 0,
        family: true,
      });
    });

    it('queues it for moderation and verifies it on approval', async () => {
      const q = (await db.query(`select moderation_queue() as q`)).rows[0].q;
      const s = q.submissions.find((x: { event_id: string }) => x.event_id === published);
      expect(s).toMatchObject({ kind: 'user', submitter: 'device-h' });
      await db.query(`select moderate_submission($1, 'approve', null, 'm')`, [s.id]);
      expect((await near()).find((e) => e.id === published)).toMatchObject({ verified: true });
      await expect(
        db.query(`select moderate_submission($1, 'reject', null, 'm')`, [s.id]),
      ).rejects.toThrow(/already reviewed/);
    });

    it('hides a rejected submission', async () => {
      const p = submission('Spam spam');
      await db.query(`select submit_event($1, 'device-hash-2', 'wroclaw', true)`, [p]);
      await db.query(`select moderate_submission($1, 'reject', 'spam', 'm')`, [p.id]);
      expect((await near()).some((e) => e.id === `submissions:${p.id}`)).toBe(false);
    });

    it('collects reports per event, once per device, and resolves them', async () => {
      await db.query(`select report_event($1, 'cancelled', 'Odwołane, kartka na drzwiach', 'r1')`, [
        published,
      ]);
      await db.query(`select report_event($1, 'cancelled', null, 'r2')`, [published]);
      // The map shows the open status reports at once (count of devices, most reported reason).
      expect((await near()).find((e) => e.id === published)).toMatchObject({
        flag_reason: 'cancelled',
        flag_count: 2,
      });
      // Same device again: its report is updated, not doubled; wrong_info is for moderators only.
      await db.query(`select report_event($1, 'wrong_info', null, 'r1')`, [published]);
      await db.query(`select report_event($1, 'weather', 'Burza, plener odwołany', 'r3')`, [
        published,
      ]);
      expect((await near()).find((e) => e.id === published)).toMatchObject({
        flag_count: 2, // r2 cancelled + r3 weather
        flag_reason: 'weather', // tie broken by the latest report
      });
      await expect(db.query(`select report_event('nope', 'other', null, 'r1')`)).rejects.toThrow(
        /unknown event/,
      );
      const q = (await db.query(`select moderation_queue() as q`)).rows[0].q;
      const r = q.reports.find((x: { event_id: string }) => x.event_id === published);
      expect(r).toMatchObject({
        count: 3,
        reasons: { cancelled: 1, wrong_info: 1, weather: 1 },
        notes: ['Burza, plener odwołany', 'Odwołane, kartka na drzwiach'],
      });
      const n = (
        await db.query(`select resolve_reports($1, 'cancel', null, 'm') as n`, [published])
      ).rows[0].n;
      expect(n).toBe(3);
      expect((await near()).some((e) => e.id === published)).toBe(false); // cancelled events are not listed
      const after = (await db.query(`select moderation_queue() as q`)).rows[0].q;
      expect(after.reports.some((x: { event_id: string }) => x.event_id === published)).toBe(false);
    });

    it('serves a compact area snapshot with flags and density cells, without hidden events', async () => {
      const p = submission('Potańcówka');
      await db.query(`select submit_event($1, 'device-hash-4', 'wroclaw', true)`, [p]);
      const id = `submissions:${p.id}`;
      await db.query(`select report_event($1, 'weather', null, 'w1')`, [id]);
      const area = async () =>
        (
          await db.query(
            `select * from events_area($1, $2, 5000, now(), now() + interval '24 hours')`,
            [region.center.lat, region.center.lng],
          )
        ).rows;
      const rows = await area();
      const row = rows.find((e) => e.id === id);
      expect(row).toMatchObject({ verified: false, flag_reason: 'weather', flag_count: 1 });
      expect(row.density_cell).toMatch(/^[0-9a-f]{15}$/);
      // Long fields come with the detail view only.
      expect(Object.keys(row)).not.toContain('description');
      expect(Object.keys(row)).not.toContain('image_url');
      await db.query(
        `select moderate_submission(s.id, 'reject', null, 'm') from submissions s
        where s.event_id = $1`,
        [id],
      );
      expect((await area()).some((e) => e.id === id)).toBe(false);
    });

    it('clears the flag when a moderator dismisses the reports', async () => {
      const p = submission('Koncert w parku');
      await db.query(`select submit_event($1, 'device-hash-3', 'wroclaw', true)`, [p]);
      const id = `submissions:${p.id}`;
      await db.query(`select report_event($1, 'venue_closed', null, 'x1')`, [id]);
      expect((await near()).find((e) => e.id === id)).toMatchObject({
        flag_reason: 'venue_closed',
        flag_count: 1,
      });
      await db.query(`select resolve_reports($1, 'dismiss', null, 'm')`, [id]);
      expect((await near()).find((e) => e.id === id)).toMatchObject({
        flag_reason: null,
        flag_count: 0,
        flag_at: null,
      });
    });

    it('rate-limits per actor and window, and knows its moderators', async () => {
      const hit = async () =>
        (await db.query(`select rate_limit_hit('autofill', 'ip1', 3600, 2) as ok`)).rows[0].ok;
      expect([await hit(), await hit(), await hit()]).toEqual([true, true, false]);
      await db.query(`insert into moderators (email) values ('mod@example.org')`);
      const is = async (e: string) =>
        (await db.query(`select is_moderator($1) as m`, [e])).rows[0].m;
      expect(await is('MOD@example.org')).toBe(true);
      expect(await is('someone@example.org')).toBe(false);
    });
  });

  it('keeps geocoder and extraction caches', async () => {
    const geo = store.geocodeCache('nominatim', 30);
    expect(await geo.get('k')).toBeUndefined();
    await geo.set('k', null);
    expect(await geo.get('k')).toBeNull(); // cached "not found"
    await geo.set('k2', { point: { lat: 1, lng: 2 }, precision: 'address', label: 'x' });
    expect(await geo.get('k2')).toMatchObject({ precision: 'address' });
    const ext = store.extractionCache('fake:1');
    await ext.set('h', []);
    expect(await ext.get('h')).toEqual([]);
  });
});
