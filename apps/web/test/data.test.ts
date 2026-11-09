import { describe, expect, it, vi } from 'vitest';
import seed from '../../../data/seed/wroclaw.events.json';
import { StaticEventRepository } from '../src/data/static';
import { SupabaseEventRepository } from '../src/data/supabase';
import { config, region } from '../src/config';
import { formatDistance, formatRelativeDay } from '../src/format';
import { eventToIcs } from '../src/ics';
import { translate } from '../src/i18n';

describe('StaticEventRepository', () => {
  const now = new Date('2026-10-20T14:00:00Z');
  const repo = new StaticEventRepository(
    async () => seed,
    region,
    config.categories,
    config.app.h3,
    now,
  );

  it('returns events in radius and time window, nearest first', async () => {
    const res = await repo.near({
      center: region.center,
      radiusM: 500,
      from: now,
      to: new Date(now.getTime() + 6 * 3600_000),
    });
    expect(res.length).toBeGreaterThan(0);
    for (const e of res) expect(e.distanceM).toBeLessThanOrEqual(500);
    expect(res.map((e) => e.distanceM)).toEqual(
      [...res.map((e) => e.distanceM)].sort((a, b) => a - b),
    );
  });

  it('excludes events outside the window', async () => {
    const all = await repo.near({
      center: region.center,
      radiusM: 25000,
      from: now,
      to: new Date(now.getTime() + 48 * 3600_000),
    });
    const today = await repo.near({
      center: region.center,
      radiusM: 25000,
      from: now,
      to: new Date(now.getTime() + 6 * 3600_000),
    });
    expect(today.length).toBeLessThan(all.length);
  });
});

describe('SupabaseEventRepository', () => {
  it('calls events_near over PostgREST and maps rows', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            id: 'x',
            title: 'T',
            description: null,
            category_ids: ['music'],
            start_at: '2026-10-20T14:00:00Z',
            end_at: '2026-10-20T16:00:00Z',
            end_estimated: false,
            timezone: 'Europe/Warsaw',
            venue_id: 'v',
            venue_name: 'V',
            venue_address: null,
            lat: 51.1,
            lng: 17.03,
            h3_r9: '89',
            price_min: '10.00',
            price_max: null,
            currency: 'PLN',
            is_free: false,
            rules: {},
            official_url: null,
            ticket_url: null,
            image_url: null,
            status: 'scheduled',
            trust: 'api',
            confidence: 1,
            last_seen_at: '2026-10-20T13:00:00Z',
            distance_m: 120,
          },
        ]),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const repo = new SupabaseEventRepository('https://example.supabase.co/', 'anon');
    const [ev] = await repo.near({
      center: { lat: 51.1, lng: 17 },
      radiusM: 500,
      from: new Date(),
      to: new Date(),
    });
    expect(fetchMock.mock.calls[0]![0]).toBe('https://example.supabase.co/rest/v1/rpc/events_near');
    expect(ev).toMatchObject({
      id: 'x',
      priceMin: 10,
      priceMax: null,
      point: { lat: 51.1, lng: 17.03 },
      distanceM: 120,
    });
    vi.unstubAllGlobals();
  });
});

describe('format', () => {
  it('formats distances per language', () => {
    expect(formatDistance(347, 'pl')).toBe('350 m');
    expect(formatDistance(1234, 'pl')).toBe('1,2 km');
    expect(formatDistance(1234, 'en')).toBe('1.2 km');
    expect(formatDistance(25000, 'en')).toBe('25 km');
  });
  it('names a day with its year only when it is not this year', () => {
    const at = new Date('2026-11-09T12:00:00Z');
    const day = (iso: string) => formatRelativeDay(iso, at, 'Europe/Warsaw', 'en');
    expect(day('2026-11-10T18:00:00Z')).toBe('tomorrow');
    expect(day('2026-12-15T18:00:00Z')).toBe('Tue, Dec 15');
    expect(day('2027-12-15T18:00:00Z')).toBe('Wed, Dec 15, 2027');
  });
});

const now = new Date('2026-10-20T14:00:00Z');
const repo = new StaticEventRepository(
  async () => seed,
  region,
  config.categories,
  config.app.h3,
  now,
);
const day = {
  center: region.center,
  radiusM: 25000,
  from: now,
  to: new Date(now.getTime() + 12 * 3600_000),
};

describe('StaticEventRepository filters', () => {
  it('filters by category (any overlap) and price', async () => {
    const all = await repo.near(day);
    const music = await repo.near({ ...day, categories: ['music'] });
    expect(music.length).toBeGreaterThan(0);
    expect(music.length).toBeLessThan(all.length);
    for (const e of music) expect(e.categoryIds).toContain('music');

    const free = await repo.near({ ...day, price: 'free' });
    const paid = await repo.near({ ...day, price: 'paid' });
    expect(free.every((e) => e.isFree)).toBe(true);
    expect(paid.every((e) => !e.isFree)).toBe(true);
    expect(free.length + paid.length).toBe(all.length);
  });

  it('finds one event by id with its distance', async () => {
    const [first] = await repo.near(day);
    const ev = await repo.byId(first!.id, region.center);
    expect(ev?.id).toBe(first!.id);
    expect(ev?.distanceM).toBeCloseTo(first!.distanceM, 3);
    expect(ev?.sourceId).toBe('seed');
    expect(await repo.byId('nope', region.center)).toBeNull();
  });
});

describe('SupabaseEventRepository filters', () => {
  it('sends category and price filters, and fetches details by id', async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init: RequestInit) => new Response('[]', { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const r = new SupabaseEventRepository('https://example.supabase.co', 'anon');
    await r.near({ ...day, categories: ['music', 'sport'], price: 'free' });
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body as string)).toMatchObject({
      categories: ['music', 'sport'],
      price: 'free',
    });
    await r.near(day);
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body as string)).toMatchObject({
      categories: null,
      price: 'any',
    });
    expect(await r.byId('ticketmaster:1', region.center)).toBeNull();
    expect(fetchMock.mock.calls[2]![0]).toBe('https://example.supabase.co/rest/v1/rpc/event_by_id');
    expect(JSON.parse(fetchMock.mock.calls[2]![1].body as string)).toMatchObject({
      event_id: 'ticketmaster:1',
    });
    vi.unstubAllGlobals();
  });
});

describe('iCalendar export', () => {
  it('writes a valid single-event calendar with escaped, folded text', async () => {
    const [ev] = await repo.near(day);
    const ics = eventToIcs(
      { ...ev!, title: 'Jazz, wine; and more', description: 'Line one\nLine two '.repeat(10) },
      'https://happow.example/#/e/x',
      now,
    );
    expect(ics).toMatch(/^BEGIN:VCALENDAR\r\n/);
    expect(ics).toContain('SUMMARY:Jazz\\, wine\\; and more');
    expect(ics).toContain(`DTSTART:${ev!.startAt.replace(/[-:]/g, '').replace('.000', '')}`);
    expect(ics).toContain('DTSTAMP:20261020T140000Z');
    for (const line of ics.split('\r\n'))
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
  });
});

describe('i18n plural exact matches', () => {
  it('uses =0 before plural categories', () => {
    expect(translate('en', 'filters.show', { count: 0 })).toBe('No events');
    expect(translate('en', 'filters.show', { count: 1 })).toBe('Show 1 event');
    expect(translate('pl', 'filters.show', { count: 0 })).toBe('Brak wydarzeń');
    expect(translate('pl', 'filters.show', { count: 3 })).toBe('Pokaż 3 wydarzenia');
    expect(translate('pl', 'filters.show', { count: 12 })).toBe('Pokaż 12 wydarzeń');
  });
});
