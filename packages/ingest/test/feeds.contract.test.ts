import { describe, expect, it, vi } from 'vitest';
import type { Geocoder } from '@happow/extract';
import { accountFeedsJob, type DueFeed, type FeedStore } from '../src/feeds';
import type { EventStore } from '../src/store';
import { config, fixture, noSleep, region, source } from './helpers';

/** M12 slice L: an account's calendar feed read into its submissions (recorded iCal feed). */

const now = new Date('2026-10-29T12:00:00Z');
const FEED: DueFeed = {
  id: 7,
  userId: 'u1',
  url: 'https://klub.example/kalendarz.ics',
  approved: false,
};

function fakeStore(opts: { known?: Set<string>; quotaAfter?: number; feeds?: DueFeed[] } = {}) {
  const imported: {
    feed: number;
    key: string;
    payload: { form: Record<string, unknown> };
    max: number;
  }[] = [];
  const records: { feed: number; error: string | null; events: number }[] = [];
  const known = opts.known ?? new Set<string>();
  const feeds: Partial<FeedStore> = {
    due: async () => opts.feeds ?? [FEED],
    grants: async () => [],
    import: async (a) => {
      if (opts.quotaAfter !== undefined && imported.length >= opts.quotaAfter)
        throw Object.assign(new Error('events quota used up'), { code: 'HQ001' });
      if (known.has(a.key)) return null;
      known.add(a.key);
      imported.push(a as (typeof imported)[number]);
      return { id: `s${imported.length}`, trusted: false };
    },
    record: async (feed, error, events) => {
      records.push({ feed, error, events });
    },
  };
  const store = { feeds: () => feeds } as unknown as EventStore;
  return { store, imported, records, known };
}

function web(body: string | null) {
  return vi.fn(async (input: string | URL | Request) =>
    String(input) === FEED.url && body !== null
      ? new Response(body, { status: 200, headers: { 'content-type': 'text/calendar' } })
      : new Response('gone', { status: 404 }),
  ) as unknown as typeof fetch;
}
const geocoder: Geocoder = {
  geocode: async () => ({ point: { lat: 51.11, lng: 17.03 }, precision: 'address', label: 'x' }),
};
const run = (store: EventStore, fetch: typeof globalThis.fetch, g: Geocoder | null = geocoder) =>
  accountFeedsJob({
    source: source('account-feeds'),
    region,
    config,
    now,
    store,
    fetch,
    sleep: noSleep,
    log: () => {},
    geocoder: g,
  });

describe('account feeds job (M12 §4.6)', () => {
  it('imports the feed’s upcoming events in person, each once, as the account’s submissions', async () => {
    const s = fakeStore();
    const stats = await run(s.store, web(fixture('venues/wroclaw-club.ics')));
    const titles = s.imported.map((i) => i.payload.form.title);
    // Upcoming, with a place name: the weekly jam's dates, its moved date. The concert has only
    // GEO, and every submission needs a place name, so it stays out.
    expect(titles).not.toContain('Koncert jesienny');
    expect(titles).toContain('Jam session (later start)');
    expect(titles).toContain('Jam session');
    // Past (28 Oct, UTC), online, cancelled and broken ones never come in.
    expect(titles).not.toContain('Warsztaty w UTC');
    expect(titles).not.toContain('Transmisja online');
    expect(titles).not.toContain('Bez daty');
    expect(new Set(s.imported.map((i) => i.key)).size).toBe(s.imported.length);
    const jam = s.imported.find((i) => i.payload.form.start === '2026-11-17T20:00')!;
    expect(jam.payload.form).toMatchObject({
      start: '2026-11-17T20:00',
      venueName: 'Klub Przykładowy',
      point: { lat: 51.11, lng: 17.03 },
    });
    // The account's plan sets the month's quota.
    expect(jam.max).toBe(config.plans.plans.premium['events.perMonth']);
    expect(stats).toMatchObject({ feeds: 1, imported: s.imported.length, failed: 0 });
    expect(s.records).toEqual([{ feed: 7, error: null, events: s.imported.length }]);

    // The next run finds them all known.
    const again = fakeStore({ known: s.known });
    const second = await run(again.store, web(fixture('venues/wroclaw-club.ics')));
    expect(second).toMatchObject({ imported: 0, known: s.imported.length });
  });

  it('stops a feed for this run when the month’s events are used up', async () => {
    const s = fakeStore({ quotaAfter: 2 });
    const stats = await run(s.store, web(fixture('venues/wroclaw-club.ics')));
    expect(s.imported).toHaveLength(2);
    expect(stats).toMatchObject({ quota: 1 });
    expect(s.records).toEqual([{ feed: 7, error: 'quota', events: 2 }]);
  });

  it('records a feed that can’t be read, and goes on with the next', async () => {
    const other = { ...FEED, id: 8, url: 'https://gone.example/x.ics' };
    const s = fakeStore({ feeds: [other, FEED] });
    const stats = await run(s.store, web(fixture('venues/wroclaw-club.ics')));
    expect(stats).toMatchObject({ failed: 1 });
    expect(s.records[0]).toMatchObject({ feed: 8, events: 0 });
    expect(s.records[0]!.error).toBeTruthy();
    expect(s.records[1]).toMatchObject({ feed: 7, error: null });
  });

  it('skips events it can’t place without a geocoder', async () => {
    const s = fakeStore();
    await run(s.store, web(fixture('venues/wroclaw-club.ics')), null);
    // The events with a place name have no coordinates; the one with GEO has no name.
    expect(s.imported).toEqual([]);
  });

  it('writes nothing on a dry run', async () => {
    expect(
      await accountFeedsJob({
        source: source('account-feeds'),
        region,
        config,
        now,
        store: null,
        log: () => {},
      }),
    ).toMatchObject({
      skipped: expect.any(String),
    });
  });
});
