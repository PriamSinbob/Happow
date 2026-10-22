import { describe, expect, it, vi } from 'vitest';
import type { ExtractedEvent, Extractor, Geocoder } from '@happow/extract';
import { MemoryCache } from '@happow/extract';
import { runIngest, weeklyQueries } from '../src';
import { config, fixture, noSleep, replayFetch, source } from './helpers';

// The source is off in config until Meta App Review; the contract is tested with it on.
const on = (patch: Record<string, unknown> = {}) => ({
  ...config,
  sources: config.sources.map((s) => (s.id === 'threads' ? { ...s, enabled: true, ...patch } : s)),
});
const env = { THREADS_ACCESS_TOKEN: 'tok', ANTHROPIC_API_KEY: 'k' };
const now = new Date('2026-10-23T12:00:00Z');
// One response per configured keyword (five for Wrocław).
const responses = () => [
  fixture('threads/search-0.json'),
  fixture('threads/search-1.json'),
  ...Array(3).fill(fixture('threads/empty.json')),
];

const event = (city: string): ExtractedEvent => ({
  title: 'Wyprzedaż garażowa na podwórku',
  description: 'Ubrania, książki, rowery dziecięce',
  start: '2026-10-24T10:00',
  end: '2026-10-24T15:00',
  venueName: null,
  address: { street: 'Jedności Narodowej 61', postalCode: null, city, country: null },
  point: null,
  isFree: true,
  priceMin: null,
  priceMax: null,
  currency: null,
  url: 'https://example.com/private-album',
  ticketUrl: null,
  imageUrl: 'https://example.com/photo.jpg',
  status: 'scheduled',
  ageMin: null,
  family: null,
  entry: null,
  online: false,
  categoryHints: [],
  categoryIds: ['garage-sale'],
  method: 'llm',
  confidence: 0.8,
});

const geocoder: Geocoder = {
  async geocode() {
    return { point: { lat: 51.1235, lng: 17.0412 }, precision: 'address', label: 'x' };
  },
};

describe('threads (contract, documented response shape)', () => {
  it('turns matching posts into events, keeping facts and the post link only', async () => {
    const extract = vi.fn(async (input: Parameters<Extractor['extract']>[0]) =>
      input.text.includes('Krakowie') ? [event('Kraków')] : [event('Wrocław')],
    );
    const { fetch, calls } = replayFetch(responses());
    const [s] = await runIngest({
      config: on(),
      env,
      now,
      store: null,
      force: true,
      sourceIds: ['threads'],
      fetch,
      sleep: noSleep,
      log: () => {},
      geocoder,
      extractor: { id: 'fake:1', extract },
      extractionCache: new MemoryCache(),
    });

    expect(s).toMatchObject({ status: 'ok', fetched: 1 });
    expect(calls).toHaveLength(5);
    const first = new URL(calls[0]!.url);
    expect(first.searchParams.get('q')).toBe('wyprzedaż garażowa Wrocław');
    // No author fields are requested, and the token travels in a header, not the URL.
    expect(first.searchParams.get('fields')).toBe('id,text,permalink,timestamp');
    expect(calls[0]!.url).not.toContain('tok');
    expect(new Headers(calls[0]!.init.headers).get('authorization')).toBe('Bearer tok');

    // The duplicate post is read once and the empty one not at all; dates count from the post.
    expect(extract).toHaveBeenCalledTimes(2);
    expect(extract.mock.calls[0]![0]).toMatchObject({ today: '2026-10-21' });

    const [only] = s!.events!;
    expect(only!.sourceUrl).toBe('https://www.threads.net/@example_user/post/DBxAAAAAAA1');
    expect(only!.event).toMatchObject({
      title: 'Wyprzedaż garażowa na podwórku',
      startAt: '2026-10-24T08:00:00.000Z',
      categoryIds: ['garage-sale'],
      trust: 'community',
      description: null,
      imageUrl: null,
      officialUrl: 'https://www.threads.net/@example_user/post/DBxAAAAAAA1',
    });
  });

  it('refuses to run when the keywords and schedule would exceed the weekly quota', async () => {
    expect(weeklyQueries(source('threads'))).toBeLessThanOrEqual(
      source('threads').options.queriesPer7Days as number,
    );
    const { fetch, calls } = replayFetch(responses());
    const [s] = await runIngest({
      config: on({ schedule: '30m' }),
      env,
      now,
      store: null,
      force: true,
      sourceIds: ['threads'],
      fetch,
      sleep: noSleep,
      log: () => {},
      extractor: { id: 'fake:1', extract: async () => [] },
    });
    expect(s).toMatchObject({ status: 'failed' });
    expect(s!.reason).toMatch(/1680 queries a week .* quota of 500/);
    expect(calls).toHaveLength(0);
  });

  it('is skipped without its token', async () => {
    const [s] = await runIngest({
      config: on(),
      env: { ANTHROPIC_API_KEY: 'k' },
      now,
      store: null,
      force: true,
      sourceIds: ['threads'],
      log: () => {},
    });
    expect(s).toMatchObject({ status: 'skipped', reason: 'missing THREADS_ACCESS_TOKEN' });
  });
});
