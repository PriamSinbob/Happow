import { describe, expect, it, vi } from 'vitest';
import type { ExtractedEvent, Extractor } from '@happow/extract';
import { MemoryCache, reservedByMeta, reservedByRules, parseTdmRep } from '@happow/extract';
import { adapters, HttpClient } from '../src';
import type { AdapterContext, PageCache, PageEntry, PolitenessStats } from '../src/types';
import { config, noSleep, region } from './helpers';

/** Conditional requests, unchanged pages, revisits and TDM reservations. */

const now = new Date('2026-11-05T10:00:00Z');
const START = 'https://club.example.pl/events/';
const EVENT = 'https://club.example.pl/events/42';

const jsonLd = (start: string) =>
  `<html><head><script type="application/ld+json">${JSON.stringify({
    '@type': 'MusicEvent',
    name: 'Koncert',
    startDate: start,
    location: { '@type': 'Place', name: 'Klub', address: 'Ruska 46, Wrocław' },
  })}</script></head><body><a href="/events/42">Koncert</a></body></html>`;
const plain = (extra = '') =>
  `<html><head>${extra}</head><body><h1>Wieczór poezji</h1><p>20 listopada, 19:00</p></body></html>`;

type Answer = { status: number; body?: string; headers?: Record<string, string> };
function site(answer: (url: string, headers: Headers) => Answer) {
  const requests: { url: string; headers: Headers }[] = [];
  const fetchMock = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    const headers = new Headers(init.headers);
    requests.push({ url, headers });
    if (url.endsWith('/robots.txt'))
      return new Response('User-agent: *\nAllow: /', { status: 200 });
    const a = answer(url, headers);
    return new Response(a.status === 304 ? null : (a.body ?? ''), {
      status: a.status,
      headers: { 'content-type': 'text/html', ...a.headers },
    });
  });
  return { fetch: fetchMock as unknown as typeof fetch, requests };
}

function memoryPages(): PageCache & { map: Map<string, PageEntry> } {
  const map = new Map<string, PageEntry>();
  return { map, get: async (u) => map.get(u), set: async (u, e) => void map.set(u, e) };
}

const llmEvent: ExtractedEvent = {
  title: 'Wieczór poezji',
  description: null,
  start: '2026-11-20T19:00',
  end: null,
  venueName: 'Klub',
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
  entry: null,
  online: false,
  categoryHints: [],
  categoryIds: ['talk'],
  method: 'llm',
  confidence: 0.9,
};

async function crawl(
  fetch: typeof globalThis.fetch,
  pages: PageCache,
  at = now,
  options: Record<string, unknown> = { followPattern: '/events/\\d+$', maxFollow: 5 },
  extractor?: Extractor,
) {
  const stats: PolitenessStats = {
    notModified: 0,
    unchanged: 0,
    revisitSkipped: 0,
    tdmReserved: 0,
  };
  const source = {
    ...config.sources.find((s) => s.id === 'nfm')!,
    id: 'club',
    defaultVenue: undefined,
    options: { startUrls: [START], llmFallback: true, ...options },
  };
  const ctx: AdapterContext = {
    source,
    region,
    window: { from: at, to: new Date(at.getTime() + 60 * 86_400_000) },
    http: new HttpClient({ userAgent: 'Happow/0.5', fetch, sleep: noSleep }),
    env: {},
    now: at,
    services: {
      extractor: extractor ?? null,
      extractionCache: new MemoryCache(),
      categories: config.categories,
      userAgent: 'Happow/0.5',
      maxInputChars: 12000,
      maxPageBytes: 2_000_000,
      pages,
      politeness: { ...config.app.ingest.politeness, stats },
    },
  };
  const raws = await adapters.crawler!.fetch(ctx);
  return { raws, stats };
}

describe('crawler politeness', () => {
  it('sends the validators back and reuses the last read on 304', async () => {
    const pages = memoryPages();
    const first = site(() => ({
      status: 200,
      body: jsonLd('2026-11-06T19:00:00+01:00'),
      headers: { etag: '"v1"', 'last-modified': 'Wed, 04 Nov 2026 10:00:00 GMT' },
    }));
    const a = await crawl(first.fetch, pages);
    expect(a.raws.length).toBeGreaterThan(0);

    const second = site((_, h) =>
      h.get('if-none-match') === '"v1"' ? { status: 304 } : { status: 200, body: 'changed' },
    );
    const b = await crawl(second.fetch, pages, new Date(now.getTime() + 86_400_000));
    const start = second.requests.find((r) => r.url === START)!;
    expect(start.headers.get('if-none-match')).toBe('"v1"');
    expect(start.headers.get('if-modified-since')).toBe('Wed, 04 Nov 2026 10:00:00 GMT');
    expect(b.stats.notModified).toBeGreaterThanOrEqual(1);
    expect(b.raws.map((r) => r.externalId)).toEqual(a.raws.map((r) => r.externalId));
  });

  it('a page with the same content is not parsed or sent to the LLM again', async () => {
    const pages = memoryPages();
    const extract = vi.fn(async () => [llmEvent]);
    const web = site(() => ({ status: 200, body: plain() }));
    const opts = { followPattern: null, maxFollow: 0 };
    await crawl(web.fetch, pages, now, opts, { id: 'fake', extract });
    const again = await crawl(web.fetch, pages, now, opts, { id: 'fake', extract });
    expect(extract).toHaveBeenCalledTimes(1);
    expect(again.stats.unchanged).toBe(1);
    expect(again.raws).toHaveLength(1);
  });

  it('skips an event page read recently whose events are still far ahead', async () => {
    const pages = memoryPages();
    const far = site(() => ({ status: 200, body: jsonLd('2026-12-20T19:00:00+01:00') }));
    await crawl(far.fetch, pages);
    const later = site(() => ({ status: 200, body: jsonLd('2026-12-20T19:00:00+01:00') }));
    const r = await crawl(later.fetch, pages, new Date(now.getTime() + 24 * 3_600_000));
    expect(later.requests.map((q) => q.url)).not.toContain(EVENT);
    expect(r.stats.revisitSkipped).toBe(1);
    // Soon: always asked again (with validators).
    const pagesSoon = memoryPages();
    const soon = site(() => ({ status: 200, body: jsonLd('2026-11-06T19:00:00+01:00') }));
    await crawl(soon.fetch, pagesSoon);
    const soonAgain = site(() => ({ status: 200, body: jsonLd('2026-11-06T19:00:00+01:00') }));
    await crawl(soonAgain.fetch, pagesSoon, new Date(now.getTime() + 3_600_000));
    expect(soonAgain.requests.map((q) => q.url)).toContain(EVENT);
  });

  it('never sends a page with a TDM reservation to the LLM (meta tag, header or tdmrep.json)', async () => {
    const opts = { followPattern: null, maxFollow: 0 };
    for (const answer of [
      () => ({ status: 200, body: plain('<meta name="tdm-reservation" content="1">') }),
      () => ({ status: 200, body: plain(), headers: { 'tdm-reservation': '1' } }),
      (url: string) =>
        url.endsWith('/.well-known/tdmrep.json')
          ? { status: 200, body: JSON.stringify([{ location: '/events/*', 'tdm-reservation': 1 }]) }
          : { status: 200, body: plain() },
    ]) {
      const extract = vi.fn(async () => [llmEvent]);
      const web = site(answer);
      const r = await crawl(web.fetch, memoryPages(), now, opts, { id: 'fake', extract });
      expect(extract).not.toHaveBeenCalled();
      expect(r.stats.tdmReserved).toBe(1);
    }
    // No reservation: the LLM reads it.
    const extract = vi.fn(async () => [llmEvent]);
    const web = site((url) =>
      url.endsWith('tdmrep.json') ? { status: 404 } : { status: 200, body: plain() },
    );
    await crawl(web.fetch, memoryPages(), now, opts, { id: 'fake', extract });
    expect(extract).toHaveBeenCalledTimes(1);
  });

  it('reads TDMRep rules: the most specific location decides', () => {
    const rules = parseTdmRep(
      JSON.stringify([
        { location: '/', 'tdm-reservation': 1 },
        { location: '/open/*', 'tdm-reservation': 0 },
      ]),
    );
    expect(reservedByRules(rules, '/events/1')).toBe(true);
    expect(reservedByRules(rules, '/open/page')).toBe(false);
    expect(reservedByRules(parseTdmRep('not json'), '/')).toBe(false);
    expect(reservedByMeta('<meta content="0" name="tdm-reservation">')).toBe(false);
  });
});
