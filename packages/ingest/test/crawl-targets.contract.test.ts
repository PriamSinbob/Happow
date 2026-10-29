import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { ExtractedEvent, Extractor, Geocoder } from '@happow/extract';
import { MemoryCache } from '@happow/extract';
import { runIngest } from '../src';
import { config, noSleep } from './helpers';

/**
 * M12 slice K: more crawl targets, on pages recorded on 29 Oct 2026. They are off in config
 * until the owner switches them on, so each test turns its source on.
 */

const page = (name: string) =>
  readFileSync(new URL(`../../extract/test/fixtures/${name}`, import.meta.url), 'utf8');

function site(pages: Record<string, string | { status: number }>) {
  const requested: string[] = [];
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    requested.push(url);
    const body = pages[url];
    if (body === undefined) return new Response('not found', { status: 404 });
    if (typeof body !== 'string') return new Response('', { status: body.status });
    const type = url.endsWith('.txt') ? 'text/plain' : 'text/html; charset=utf-8';
    return new Response(body, { status: 200, headers: { 'content-type': type } });
  });
  return { fetch: fetchMock as unknown as typeof fetch, requested };
}

const geocoder: Geocoder = {
  geocode: async () => ({
    point: { lat: 51.1079, lng: 17.0385 },
    precision: 'address',
    label: 'x',
  }),
};
const now = new Date('2026-10-29T12:00:00Z');
const on = (id: string) => ({
  ...config,
  sources: config.sources.map((s) => (s.id === id ? { ...s, enabled: true } : s)),
});
const run = (id: string, fetch: typeof globalThis.fetch, extra: object = {}) =>
  runIngest({
    config: on(id),
    env: { ANTHROPIC_API_KEY: 'k' },
    now,
    store: null,
    force: true,
    sleep: noSleep,
    log: () => {},
    sourceIds: [id],
    fetch,
    geocoder,
    ...extra,
  });

const llmEvent = (title: string, start: string, venueName: string): ExtractedEvent => ({
  title,
  description: null,
  start,
  end: null,
  venueName,
  address: { street: null, postalCode: null, city: 'Wrocław', country: null },
  point: null,
  isFree: true,
  priceMin: null,
  priceMax: null,
  currency: null,
  url: null,
  ticketUrl: null,
  imageUrl: null,
  status: 'scheduled',
  ageMin: null,
  family: null,
  entry: 'fixed',
  online: false,
  categoryHints: [],
  categoryIds: ['talk'],
  method: 'llm',
  confidence: 0.9,
});

describe('more crawl targets (M12 §2.4–2.5)', () => {
  it('are all off until the owner switches them on, with their terms written down', () => {
    for (const id of ['biletyna', 'mbp-wroclaw', 'uwr']) {
      const s = config.sources.find((x) => x.id === id)!;
      expect(s).toMatchObject({ enabled: false, adapter: 'crawler', trustLevel: 'crawled' });
      expect(s.termsNotes).toMatch(/Checked 2026-10-29/);
    }
  });

  it('reads Biletyna’s Wrocław listing from its JSON-LD alone, without following pages', async () => {
    const web = site({
      'https://biletyna.pl/robots.txt': page('biletyna-robots.txt'),
      'https://biletyna.pl/Wroclaw': page('biletyna-wroclaw.html'),
    });
    const [s] = await run('biletyna', web.fetch);
    expect(s).toMatchObject({ status: 'ok' });
    expect(web.requested).toEqual([
      'https://biletyna.pl/robots.txt',
      'https://biletyna.pl/Wroclaw',
    ]);
    expect(s!.events!.length).toBeGreaterThanOrEqual(30);
    const fale = s!.events!.find(({ event }) => event.title === 'Kolejność fal')!;
    expect(fale.event).toMatchObject({
      startAt: '2026-10-29T18:00:00.000Z', // 19:00 Warsaw time
      categoryIds: ['theatre'],
      isFree: false,
      currency: 'PLN',
      trust: 'crawled',
    });
    expect(fale.venue?.name).toMatch(/Teatr Współczesny/);
    expect(s!.events!.some(({ event }) => event.categoryIds.includes('music'))).toBe(true);
  });

  it('follows the library’s event pages and reads them with the LLM', async () => {
    const web = site({
      'https://biblioteka.wroc.pl/robots.txt': page('mbp-robots.txt'),
      'https://biblioteka.wroc.pl/wydarzenia/': page('mbp-listing.html'),
      'https://biblioteka.wroc.pl/co-i-jak-czytal-rozewicz-4-11/': page('mbp-event.html'),
    });
    const extract = vi.fn(async (input: Parameters<Extractor['extract']>[0]) =>
      input.text.includes('Różewicz') && input.url.includes('rozewicz')
        ? [llmEvent('Co i jak czytał Różewicz?', '2026-11-04T17:00', 'Mediateka')]
        : [],
    );
    const [s] = await run('mbp-wroclaw', web.fetch, {
      extractor: { id: 'fake:1', extract },
      extractionCache: new MemoryCache<ExtractedEvent[]>(),
    });
    expect(s).toMatchObject({ status: 'ok' });
    // robots.txt, the listing, and at most options.maxFollow (30) event pages.
    expect(web.requested.length).toBeLessThanOrEqual(32);
    expect(web.requested).toContain('https://biblioteka.wroc.pl/co-i-jak-czytal-rozewicz-4-11/');
    expect(web.requested.every((u) => !u.includes('/katalog/') && !u.includes('/filie/'))).toBe(
      true,
    );
    const ev = s!.events!.find(({ event }) => event.title.startsWith('Co i jak'))!;
    expect(ev.event).toMatchObject({ startAt: '2026-11-04T16:00:00.000Z', categoryIds: ['talk'] });
  });

  it('follows the university’s event pages, and reads robots.txt’s 403 as no rules', async () => {
    const web = site({
      'https://uwr.edu.pl/robots.txt': { status: 403 },
      'https://uwr.edu.pl/wydarzenia/': page('uwr-listing.html'),
      'https://uwr.edu.pl/wydarzenia/szewskie-czwartki-wyklad-dr-lukasza-sobechowicza/':
        page('uwr-event.html'),
    });
    const extract = vi.fn(async (input: Parameters<Extractor['extract']>[0]) =>
      input.url.includes('sobechowicza')
        ? [llmEvent('Szewskie czwartki: wykład', '2026-11-05T18:00', 'Uniwersytet Wrocławski')]
        : [],
    );
    const [s] = await run('uwr', web.fetch, {
      extractor: { id: 'fake:1', extract },
      extractionCache: new MemoryCache<ExtractedEvent[]>(),
    });
    expect(s).toMatchObject({ status: 'ok' });
    expect(web.requested.length).toBeLessThanOrEqual(22);
    expect(s!.events!.map(({ event }) => event.title)).toContain('Szewskie czwartki: wykład');
  });
});
