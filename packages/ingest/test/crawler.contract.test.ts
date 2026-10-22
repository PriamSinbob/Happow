import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { ExtractedEvent, Extractor, GeoQuery, Geocoder } from '@happow/extract';
import { MemoryCache } from '@happow/extract';
import { runIngest } from '../src';
import { crawler } from '../src/adapters/crawler';
import { config, noSleep, region } from './helpers';

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
  it('treats the eBilet listing as a summary and reads each show page for Wrocław dates', async () => {
    const web = site({
      'https://www.ebilet.pl/robots.txt': page('ebilet-robots.txt'),
      'https://www.ebilet.pl/miasto/wroclaw': page('ebilet-listing.html'),
      // Other followed show pages are missing here and answer 404, which the crawl skips.
      'https://www.ebilet.pl/muzyka/hard-heavy/metallica-symfonicznie': page('ebilet-event-1.html'),
      'https://www.ebilet.pl/muzyka/rock/pidzama-porno': page('ebilet-event-2.html'),
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
    // Listing summaries (tours with a first date in another city) are not stored.
    const events = s!.events!.map((e) => e.event);
    expect(events.map((e) => e.title).sort()).toEqual([
      'Muzyka zespołu Metallica symfonicznie',
      'Pidżama Porno',
    ]);
    expect(web.requested.filter((u) => u.includes('/muzyka/')).length).toBeGreaterThan(10);
    expect(geocoder.calls.every((q) => q.city === 'Wrocław')).toBe(true);
    const metallica = events.find((e) => e.title.startsWith('Muzyka'))!;
    expect(metallica).toMatchObject({
      startAt: '2026-11-11T18:00:00.000Z',
      venue: expect.objectContaining({ name: 'Sala Koncertowa Radia Wrocław' }),
      priceMin: 159.9,
      currency: 'PLN',
      isFree: false,
    });
    expect(metallica.ticketUrl).toMatch(/^https:\/\/www\.ebilet\.pl\//);
    for (const event of events) {
      expect(event.trust).toBe('crawled');
      expect(event.description).toBeNull(); // republishDescription: false
      expect(event.imageUrl).toBeNull(); // republishImages: false
      expect(event.officialUrl).toMatch(/^https:\/\/www\.ebilet\.pl\//);
      expect(event.timezone).toBe('Europe/Warsaw');
      expect(event.categoryIds).toContain('music'); // "/muzyka/…" path segment
    }
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

  it('skips an event page that times out instead of failing the whole crawl', async () => {
    const slow = 'https://www.wroclaw.pl/go/wydarzenia/edukacja-i-rozwoj/1416880-cool-moms-club';
    const web = site({
      'https://www.wroclaw.pl/robots.txt': page('wroclaw-robots.txt'),
      'https://www.wroclaw.pl/go/': page('go-listing.html'),
      'https://www.wroclaw.pl/go/wydarzenia/dla-dzieci/1403864-bajkowe-poranki-w-centrum-historii-zajezdnia-1':
        page('go-event-2.html'),
    });
    const timeoutOn = (async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input) === slow)
        throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      return web.fetch(input, init);
    }) as typeof fetch;
    const [s] = await runIngest({ ...base, sourceIds: ['wroclaw-go'], fetch: timeoutOn, geocoder });
    expect(s).toMatchObject({ status: 'ok' });
    const titles = s!.events!.map(({ event }) => event.title);
    expect(titles.some((t) => t.startsWith('Cool Moms Club'))).toBe(false);
    expect(titles.length).toBeGreaterThan(0);
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

describe('crawler date spans', () => {
  const source = config.sources.find((s) => s.id === 'wroclaw-go')!;
  const parse = (start: string, end: string | null) =>
    crawler.parse(
      {
        sourceId: 'wroclaw-go',
        externalId: 'x',
        sourceUrl: null,
        fetchedAt: now.toISOString(),
        payload: {
          pageUrl: 'https://www.wroclaw.pl/go/wydarzenia/kino/1',
          event: {
            title: 'Przegląd Kina Koreańskiego 2026',
            description: null,
            start,
            end,
            venueName: 'Kino Nowe Horyzonty',
            address: { street: null, postalCode: null, city: 'Wrocław', country: null },
            point: { lat: 51.1079, lng: 17.0385 },
            isFree: null,
            priceMin: null,
            priceMax: null,
            currency: null,
            url: null,
            ticketUrl: null,
            imageUrl: null,
            status: 'scheduled',
            online: false,
            categoryHints: [],
            categoryIds: [],
            method: 'jsonld',
            confidence: 1,
          },
        },
      },
      { source, region },
    );

  it('keeps a festival written as midnight to 23:59 days later as whole days (wroclaw.pl GO)', () => {
    // Recorded payload: a week-long review once lost its end and showed as 00:00–02:00.
    expect(parse('2026-10-23T00:00', '2026-10-29T23:59')).toMatchObject({
      startAt: '2026-10-22T22:00:00.000Z', // 23 Oct 00:00 Warsaw
      endAt: '2026-10-29T23:00:00.000Z', // 30 Oct 00:00 Warsaw: through 29 Oct
    });
    expect(parse('2026-10-23T00:00', '2026-10-30T00:00')?.endAt).toBe('2026-10-29T23:00:00.000Z');
  });

  it('still treats a timed show with a far end date as a run with an unknown end', () => {
    expect(parse('2026-10-23T19:00', '2026-12-20T21:00')?.endAt).toBeNull();
  });
});
