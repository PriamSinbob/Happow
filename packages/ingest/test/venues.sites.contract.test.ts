import { describe, expect, it, vi } from 'vitest';
import { MemoryCache } from '@happow/extract';
import { HttpClient } from '../src/http';
import { robotsGate } from '../src/robots';
import { venueSites } from '../src/adapters/venue-sites';
import { eventsPageLink, feedLinks, probeSite } from '../src/venues/probe';
import type { AdapterContext, SiteTarget } from '../src/types';
import { config, fixture, noSleep, region, source } from './helpers';

const now = new Date('2026-10-28T12:00:00Z');
const ua = config.app.ingest.userAgent;

/** Serves fixture bodies by URL; anything else is a 404. */
function web(pages: Record<string, string | { status: number; body?: string }>) {
  const requested: string[] = [];
  const f = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    requested.push(url);
    const page = pages[url];
    if (page === undefined) return new Response('not found', { status: 404 });
    if (typeof page === 'string') return new Response(page, { status: 200 });
    return new Response(page.body ?? '', { status: page.status });
  });
  const http = new HttpClient({
    userAgent: ua,
    retries: 0,
    fetch: f as typeof fetch,
    sleep: noSleep,
  });
  return { http, requested };
}

const club = {
  'https://klub.example/': fixture('venues/site-home.html'),
  'https://klub.example/wydarzenia/': fixture('venues/site-events.html'),
  'https://klub.example/kalendarz.ics': fixture('venues/wroclaw-club.ics'),
  'https://klub.example/wp-json/tribe/events/v1/events?per_page=50&start_date=2026-10-28':
    fixture('venues/tribe-demo.json'),
};

describe('website check', () => {
  const deps = (http: HttpClient) => ({
    http,
    allowed: robotsGate(http, ua),
    timeZone: region.timezone,
    now,
    horizonDays: 60,
    eventsPageWords: config.app.venues.probe.eventsPageWords,
  });

  it('finds feed links and the events page', () => {
    const home = fixture('venues/site-home.html');
    expect(feedLinks(home, 'https://klub.example/')).toEqual([
      'https://klub.example/kalendarz.ics',
    ]);
    expect(
      feedLinks(fixture('venues/site-events.html'), 'https://klub.example/wydarzenia/'),
    ).toEqual(['https://klub.example/wydarzenia/?ical=1']);
    expect(eventsPageLink(home, 'https://klub.example/', ['wydarzenia'])).toBe(
      'https://klub.example/wydarzenia/',
    );
  });

  it('finds JSON-LD on the events page, the REST API and a feed, in five requests or fewer', async () => {
    const { http, requested } = web(club);
    const r = await probeSite('https://klub.example/', deps(http));
    expect(r.status).toBe('found');
    expect(r.candidates.map((c) => [c.kind, c.url, c.count])).toEqual([
      ['jsonld', 'https://klub.example/wydarzenia/', 1],
      // The virtual class does not count.
      ['tribe', 'https://klub.example/wp-json/tribe/events/v1/events', 2],
      ['ical', 'https://klub.example/kalendarz.ics', 8],
    ]);
    expect(r.candidates[2]!.sample).toEqual([
      // From a day back: last night's jam still counts as a sign of life.
      { title: 'Jam session', start: '2026-10-27T20:00' },
      { title: 'Warsztaty w UTC', start: '2026-10-28T17:00:00.000Z' },
      { title: 'Koncert jesienny', start: '2026-10-31T19:00' },
    ]);
    expect(requested.filter((u) => !u.endsWith('/robots.txt')).length).toBeLessThanOrEqual(5);
  });

  it('stays away from a site whose robots.txt says no, and reports a site with nothing', async () => {
    const blocked = web({
      'https://zakaz.example/robots.txt': fixture('venues/robots-disallow.txt'),
    });
    expect(await probeSite('https://zakaz.example/', deps(blocked.http))).toEqual({
      status: 'blocked',
      candidates: [],
    });
    expect(blocked.requested).toEqual(['https://zakaz.example/robots.txt']);
    const plain = web({ 'https://biblioteka.example/': fixture('venues/site-plain.html') });
    expect((await probeSite('https://biblioteka.example/', deps(plain.http))).status).toBe('none');
  });

  it('reports a site that fails', async () => {
    const down = web({ 'https://down.example/': { status: 503 } });
    const r = await probeSite('https://down.example/', deps(down.http));
    expect(r.status).toBe('error');
    expect(r.error).toMatch(/503/);
  });
});

describe('venue-sites (contract, recorded and hand-built feeds)', () => {
  const targets: SiteTarget[] = [
    {
      id: 1,
      url: 'https://klub.example/kalendarz.ics',
      kind: 'ical',
      venueName: 'Klub Przykładowy',
      point: { lat: 51.10565, lng: 17.03605 },
    },
    {
      id: 2,
      url: 'https://klub.example/wydarzenia/',
      kind: 'jsonld',
      venueName: 'Klub Przykładowy',
      point: { lat: 51.10565, lng: 17.03605 },
    },
    {
      id: 3,
      url: 'https://klub.example/wp-json/tribe/events/v1/events',
      kind: 'tribe',
      venueName: 'Demo',
      point: { lat: 51.1, lng: 17.0 },
    },
    {
      id: 4,
      url: 'https://gone.example/feed.ics',
      kind: 'ical',
      venueName: 'Gone',
      point: { lat: 51.1, lng: 17.0 },
    },
  ];

  async function run() {
    const { http } = web(club);
    const results: [number, string | null, number][] = [];
    const ctx: AdapterContext = {
      source: source('venue-sites'),
      region,
      window: {
        from: new Date(now.getTime() - 6 * 3_600_000),
        to: new Date(now.getTime() + 7 * 86_400_000),
      },
      http,
      env: {},
      now,
      services: {
        extractor: null,
        extractionCache: new MemoryCache(),
        categories: config.categories,
        userAgent: ua,
        maxInputChars: 10_000,
        maxPageBytes: 1_000_000,
        siteTargets: targets,
        onSiteResult: (id, error, n) => results.push([id, error, n]),
      },
    };
    const raws = await venueSites.fetch(ctx);
    return { raws, results, parsed: raws.map((r) => venueSites.parse(r, ctx)!) };
  }

  it('reads every accepted site and reports each one, failures included', async () => {
    const { results } = await run();
    expect(results.map(([id, err, n]) => [id, err === null ? 'ok' : 'error', n])).toEqual([
      // 27 Oct is before the run's window; the online stream has no place.
      [1, 'ok', 7],
      [2, 'ok', 1],
      // The demo's venues are in New York: outside the region, so nothing is kept.
      [3, 'ok', 0],
      [4, 'error', 0],
    ]);
  });

  it('places an event without a place of its own at the site’s venue', async () => {
    const { parsed } = await run();
    const utc = parsed.find((p) => p.title === 'Warsztaty w UTC')!;
    expect(utc.venue).toMatchObject({
      name: 'Klub Przykładowy',
      point: { lat: 51.10565, lng: 17.03605 },
    });
    expect(utc.startAt).toBe('2026-10-28T17:00:00.000Z');
    // A location of its own goes to the geocoder as written.
    const jam = parsed.find((p) => p.title === 'Jam session')!;
    expect(jam.locationQuery).toEqual({
      venueName: 'Klub Przykładowy',
      street: 'ul. Przykładowa 5',
      postalCode: '50-001',
      city: 'Wrocław',
    });
    expect(jam.startAt).toBe('2026-11-17T19:00:00.000Z');
  });

  it('keeps every date of a series as its own item, and skips online events', async () => {
    const { raws, parsed } = await run();
    const jams = parsed.filter((p) => p.title.startsWith('Jam session'));
    expect(jams.map((p) => p.startAt)).toEqual([
      '2026-11-10T20:00:00.000Z',
      '2026-11-17T19:00:00.000Z',
      '2026-11-24T19:00:00.000Z',
    ]);
    expect(new Set(jams.map((p) => p.externalId)).size).toBe(3);
    expect(parsed.some((p) => p.title === 'Transmisja online')).toBe(false);
    expect(parsed.find((p) => p.title === 'Spotkanie autorskie')!.status).toBe('cancelled');
    expect(raws.every((r) => r.sourceId === 'venue-sites')).toBe(true);
  });
});
