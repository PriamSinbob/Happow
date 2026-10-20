import { describe, expect, it, vi } from 'vitest';
import seed from '../../../data/seed/wroclaw.events.json';
import { StaticEventRepository } from '../src/data/static';
import { SupabaseEventRepository } from '../src/data/supabase';
import { config, region } from '../src/config';
import { formatDistance } from '../src/format';

describe('StaticEventRepository', () => {
  const now = new Date('2026-10-20T14:00:00Z');
  const repo = new StaticEventRepository(async () => seed, region, config.categories, 9, now);

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
});
