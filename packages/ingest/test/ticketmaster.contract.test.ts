import { describe, expect, it } from 'vitest';
import { adapters, HttpClient, normalize, parsedEventSchema, runIngest } from '../src';
import { config, fixture, noSleep, region, replayFetch, source } from './helpers';

const tm = source('ticketmaster');
const now = new Date('2026-10-24T10:00:00Z');
const env = { TICKETMASTER_API_KEY: 'test-key' };
const window = { from: new Date('2026-10-24T02:00:00Z'), to: new Date('2026-10-26T10:00:00Z') };

async function fetchAll() {
  const replay = replayFetch([
    fixture('ticketmaster/page-0.json'),
    fixture('ticketmaster/page-1.json'),
  ]);
  const http = new HttpClient({ userAgent: config.app.ingest.userAgent, fetch: replay.fetch });
  const raws = await adapters.ticketmaster!.fetch({ source: tm, region, window, http, env, now });
  return { raws, calls: replay.calls };
}

function normalized(id: string, raws: Awaited<ReturnType<typeof fetchAll>>['raws']) {
  const raw = raws.find((r) => r.externalId === id)!;
  const parsed = adapters.ticketmaster!.parse(raw, { source: tm, region })!;
  const res = normalize(parsed, {
    source: tm,
    region,
    categories: config.categories,
    h3Resolution: 9,
    descriptionMaxChars: config.app.ingest.descriptionMaxChars,
    now,
  });
  if (!res.ok) throw new Error(res.reason);
  return res.value.event;
}

describe('Ticketmaster adapter (contract, recorded fixtures)', () => {
  it('queries the Discovery API around the region and pages until totalPages', async () => {
    const { calls } = await fetchAll();
    expect(calls).toHaveLength(2);
    const u = new URL(calls[0]!.url);
    expect(u.origin + u.pathname).toBe('https://app.ticketmaster.com/discovery/v2/events.json');
    expect(u.searchParams.get('apikey')).toBe('test-key');
    expect(u.searchParams.get('geoPoint')).toMatch(/^u3[0-9a-z]{7}$/);
    expect(Number(u.searchParams.get('radius'))).toBeGreaterThanOrEqual(10);
    expect(u.searchParams.get('unit')).toBe('km');
    expect(u.searchParams.get('countryCode')).toBe('PL');
    expect(u.searchParams.get('startDateTime')).toBe('2026-10-24T02:00:00Z');
    expect(u.searchParams.get('endDateTime')).toBe('2026-10-26T10:00:00Z');
    expect(u.searchParams.get('page')).toBe('0');
    expect(new URL(calls[1]!.url).searchParams.get('page')).toBe('1');
    expect((calls[0]!.init.headers as Record<string, string>)['User-Agent']).toBe(
      config.app.ingest.userAgent,
    );
  });

  it('keeps every payload unchanged and parses each into the common shape', async () => {
    const { raws } = await fetchAll();
    expect(raws).toHaveLength(9);
    for (const raw of raws) {
      expect(raw.sourceId).toBe('ticketmaster');
      expect(raw.externalId).toBe((raw.payload as { id: string }).id);
      const parsed = adapters.ticketmaster!.parse(raw, { source: tm, region });
      if (parsed) expect(() => parsedEventSchema.parse(parsed)).not.toThrow();
    }
  });

  it('maps a ticketed concert', async () => {
    const e = normalized('Z698xZb_Z17a0kA', (await fetchAll()).raws);
    expect(e).toMatchObject({
      id: 'ticketmaster:Z698xZb_Z17a0kA',
      title: 'Dawid Podsiadło',
      categoryIds: ['music'],
      startAt: '2026-10-24T18:00:00.000Z',
      endEstimated: true,
      priceMin: 149,
      priceMax: 299,
      currency: 'PLN',
      isFree: false,
      trust: 'api',
      status: 'scheduled',
      ticketUrl: 'https://www.ticketmaster.pl/event/dawid-podsiadlo-bilety/36001',
      venue: { name: 'Hala Stulecia', address: 'ul. Wystawowa 1, 51-618 Wrocław' },
      point: { lat: 51.1069, lng: 17.0773 },
    });
    expect(e.endAt).toBe('2026-10-24T20:30:00.000Z'); // music default 150 min
    expect(e.description).toBe(
      'Bramy otwierane są o 18:30. Obowiązuje zakaz wnoszenia napojów & jedzenia.',
    );
    expect(e.imageUrl).toContain('RETINA_LANDSCAPE_16_9');
    expect(e.rules.accessibility).toContain('wózkach');
    // legalAgeEnforced: false says nothing about age.
    expect(e).toMatchObject({ ageMin: null, family: null, entry: null });
    expect(e.h3r9).toMatch(/^89/);
  });

  it('maps genres, statuses, day-long listings and local-only times', async () => {
    const { raws } = await fetchAll();
    expect(normalized('Z698xZb_Z17a0kB', raws)).toMatchObject({
      categoryIds: ['theatre'],
      ageMin: 18, // legalAgeEnforced: true
      rules: {},
    });
    const match = normalized('Z698xZb_Z17a0kC', raws);
    expect(match).toMatchObject({
      status: 'cancelled',
      categoryIds: ['sport'],
      endEstimated: false,
    });
    expect(normalized('Z698xZb_Z17a0kD', raws)).toMatchObject({
      categoryIds: ['exhibition'],
      startAt: '2026-10-23T22:00:00.000Z',
      endAt: '2026-10-24T22:00:00.000Z',
      endEstimated: false,
    });
    expect(normalized('Z698xZb_Z17a0kF', raws)).toMatchObject({
      categoryIds: ['kids'],
      startAt: '2026-10-24T09:00:00.000Z',
      isFree: true,
      priceMin: 0,
    });
  });

  it('drops undated items and rejects ones outside the region or without a location', async () => {
    const replay = replayFetch([
      fixture('ticketmaster/page-0.json'),
      fixture('ticketmaster/page-1.json'),
    ]);
    const [summary] = await runIngest({
      config,
      env,
      now,
      store: null,
      sourceIds: ['ticketmaster'],
      force: true,
      fetch: replay.fetch,
      sleep: noSleep,
      log: () => {},
    });
    expect(summary).toMatchObject({
      status: 'ok',
      fetched: 9,
      dropped: 1,
      rejected: { 'outside-region': 1, 'no-location': 1 },
    });
    expect(summary!.events).toHaveLength(6);
  });

  it('is skipped, not failed, without an API key', async () => {
    const [summary] = await runIngest({
      config,
      env: {},
      store: null,
      sourceIds: ['ticketmaster'],
      force: true,
      log: () => {},
    });
    expect(summary).toMatchObject({ status: 'skipped', reason: 'missing TICKETMASTER_API_KEY' });
  });
});
