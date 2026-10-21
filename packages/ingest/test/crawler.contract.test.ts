import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { ExtractedEvent, Extractor, GeoQuery, Geocoder } from '@happow/extract';
import { MemoryCache } from '@happow/extract';
import { runIngest } from '../src';
import { config, noSleep } from './helpers';

const page = (name: string) =>
  readFileSync(new URL(`../../extract/test/fixtures/${name}`, import.meta.url), 'utf8');

/** Serves the recorded pages by URL; anything else is a 404, like a vanished event page. */
function site(pages: Record<string, string>) {
  const requested: string[] = [];
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    requested.push(url);
    const body = pages[url];
    if (body === undefined) return new Response('not found', { status: 404 });
    const type = url.endsWith('.txt') ? 'text/plain' : 'text/html; charset=utf-8';
    return new Response(body, { status: 200, headers: { 'content-type': type } });
  });
  return { fetch: fetchMock as unknown as typeof fetch, requested };
}

/** Puts every Wrocław address at a fixed spot in the centre; reports precision like Nominatim. */
const geocoder: Geocoder & { calls: GeoQuery[] } = {
  calls: [],
  async geocode(q) {
    this.calls.push(q);
    const precision = q.street
      ? 'address'
      : q.venueName
        ? 'venue'
        : q.postalCode
          ? 'postcode'
          : null;
    return precision
      ? { point: { lat: 51.1079, lng: 17.0385 }, precision, label: 'Wrocław' }
      : null;
  },
};

const now = new Date('2026-10-20T22:40:00Z');
const base = { config, env: {}, now, store: null, force: true, sleep: noSleep, log: () => {} };
// eBilet is paused in config until it consents; its page shape stays covered here.
const withEbilet = {
  ...config,
  sources: config.sources.map((s) => (s.id === 'ebilet' ? { ...s, enabled: true } : s)),
};

describe('crawler (contract, recorded pages)', () => {
  it('reads eBilet JSON-LD, keeps only the region, geocodes and stores facts only', async () => {
    const web = site({
      'https://www.ebilet.pl/robots.txt': page('ebilet-robots.txt'),
      'https://www.ebilet.pl/miasto/wroclaw': page('ebilet-listing.html'),
    });
    geocoder.calls = [];
    const [s] = await runIngest({
      ...base,
      config: withEbilet,
      sourceIds: ['ebilet'],
      fetch: web.fetch,
      geocoder,
    });
    expect(s).toMatchObject({ status: 'ok' });
    expect(s!.fetched).toBeGreaterThan(5);
    expect(s!.fetched).toBeLessThan(25); // other cities' shows dropped before geocoding
    expect(geocoder.calls.every((q) => q.city === 'Wrocław')).toBe(true);
    const events = s!.events!;
    expect(events.length).toBe(s!.fetched! - (s!.dropped ?? 0));
    for (const { event } of events) {
      expect(event.trust).toBe('crawled');
      expect(event.description).toBeNull(); // republishDescription: false
      expect(event.imageUrl).toBeNull(); // republishImages: false
      expect(event.officialUrl).toMatch(/^https:\/\/www\.ebilet\.pl\//);
      expect(event.confidence).toBeCloseTo(0.9, 5); // street-level geocode keeps JSON-LD confidence
      expect(event.timezone).toBe('Europe/Warsaw');
    }
    // URL path segments map to categories ("/muzyka/…" → music).
    expect(events.some(({ event }) => event.categoryIds.includes('music'))).toBe(true);
    // Multi-date runs lose their far end date and get a category estimate instead.
    expect(
      events.every(
        ({ event }) =>
          new Date(event.endAt).getTime() - new Date(event.startAt).getTime() <= 24 * 3_600_000,
      ),
    ).toBe(true);
  });

  it('follows city-portal event links, skips vanished pages, and asks robots.txt first', async () => {
    const web = site({
      'https://www.wroclaw.pl/robots.txt': page('wroclaw-robots.txt'),
      'https://www.wroclaw.pl/go/': page('go-listing.html'),
      'https://www.wroclaw.pl/go/wydarzenia/edukacja-i-rozwoj/1416880-cool-moms-club':
        page('go-event-1.html'),
      'https://www.wroclaw.pl/go/wydarzenia/dla-dzieci/1403864-bajkowe-poranki-w-centrum-historii-zajezdnia-1':
        page('go-event-2.html'),
    });
    const [s] = await runIngest({ ...base, sourceIds: ['wroclaw-go'], fetch: web.fetch, geocoder });
    expect(s).toMatchObject({ status: 'ok' });
    expect(web.requested[0]).toBe('https://www.wroclaw.pl/robots.txt');
    // Capped by options.maxFollow (120) plus the start page and robots.txt.
    expect(web.requested.length).toBeLessThanOrEqual(122);
    const cool = s!.events!.find(({ event }) => event.title.startsWith('Cool Moms Club'))!;
    expect(cool.event).toMatchObject({
      startAt: '2026-10-27T11:00:00.000Z', // 12:00 Warsaw time
      priceMin: 89,
      currency: 'PLN',
      isFree: false,
      categoryIds: ['talk'], // from /wydarzenia/edukacja-i-rozwoj/
      venue: { name: 'Clara Wellness Studio' },
    });
    // No street was published: found by venue name + postcode, slightly lower confidence (0.9 × 0.95).
    expect(cool.event.confidence).toBeCloseTo(0.855, 5);
    expect(s!.events!.some(({ event }) => event.categoryIds.includes('kids'))).toBe(true);
  });

  it('falls back to LLM extraction on pages without JSON-LD, once per unchanged page', async () => {
    const pages = {
      'https://www.nfm.wroclaw.pl/robots.txt': page('nfm-robots.txt'),
      'https://www.nfm.wroclaw.pl/component/nfmcalendar': page('nfm-listing.html'),
      'https://www.nfm.wroclaw.pl/pl/component/nfmcalendar/event/14132': page('nfm-event.html'),
    };
    const found: ExtractedEvent = {
      title: 'Pustynne portato',
      description: null,
      start: '2026-11-22T10:00',
      end: null,
      venueName: 'NFM, Sala Czerwona',
      address: { street: 'plac Wolności 1', postalCode: '50-071', city: 'Wrocław', country: null },
      point: null,
      isFree: false,
      priceMin: 35,
      priceMax: 120,
      currency: 'PLN',
      url: null,
      ticketUrl: null,
      imageUrl: null,
      status: 'scheduled',
      online: false,
      categoryHints: [],
      categoryIds: ['kids', 'music'],
      method: 'llm',
      confidence: 0.92,
    };
    const extract = vi.fn(async (input: Parameters<Extractor['extract']>[0]) =>
      input.text.includes('Pustynne portato') ? [found] : [],
    );
    const extractor: Extractor = { id: 'fake:1', extract };
    const extractionCache = new MemoryCache<ExtractedEvent[]>();
    const run = () =>
      runIngest({
        ...base,
        env: { ANTHROPIC_API_KEY: 'k' },
        sourceIds: ['nfm'],
        fetch: site(pages).fetch,
        geocoder,
        extractor,
        extractionCache,
      });

    const [first] = await run();
    expect(first).toMatchObject({ status: 'ok' });
    const pustynne = first!.events!.find(({ event }) => event.title === 'Pustynne portato')!;
    expect(pustynne.event).toMatchObject({
      startAt: '2026-11-22T09:00:00.000Z',
      categoryIds: ['kids', 'music'],
      trust: 'crawled',
    });
    expect(pustynne.event.confidence).toBeCloseTo(0.92, 5);
    const input = extract.mock.calls.find(([i]) => i.text.includes('Pustynne'))![0];
    expect(input).toMatchObject({ today: '2026-10-21', timeZone: 'Europe/Warsaw' });
    expect(input.categories.find((c) => c.id === 'kids')?.label).toBe('Dzieci i rodzina');

    const calls = extract.mock.calls.length;
    await run();
    expect(extract.mock.calls.length).toBe(calls); // unchanged pages come from the cache
  });

  it('is skipped without its LLM key, and other crawlers do not need one', async () => {
    const [s] = await runIngest({ ...base, sourceIds: ['nfm'] });
    expect(s).toMatchObject({ status: 'skipped', reason: 'missing ANTHROPIC_API_KEY' });
  });
});
