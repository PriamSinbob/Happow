import { renderHook } from '@testing-library/react';
import { COMPASS, distanceM, type DensityCluster } from '@happow/core';
import { describe, expect, it, vi } from 'vitest';
import seed from '../../../data/seed/wroclaw.events.json';
import { config, region } from '../src/config';
import { StaticEventRepository } from '../src/data/static';
import { rowToCluster, SupabaseEventRepository } from '../src/data/supabase';
import { useGuidance } from '../src/hooks/useGuidance';
import { en } from '../src/i18n/en';
import { pl } from '../src/i18n/pl';

const now = new Date('2026-10-20T14:00:00Z');
const repo = new StaticEventRepository(
  async () => seed,
  region,
  config.categories,
  config.app.h3,
  now,
);
const q = {
  center: region.center,
  radiusM: 300,
  from: now,
  to: new Date(now.getTime() + 12 * 3600_000),
  searchRadiusM: config.app.density.searchRadiusM,
};

describe('static density', () => {
  it('counts the same events as near() within the search radius', async () => {
    const clusters = await repo.density(q);
    const near = await repo.near({ ...q, radiusM: q.searchRadiusM });
    expect(clusters.reduce((n, c) => n + c.count, 0)).toBe(near.length);
    const inside = (await repo.near(q)).length;
    expect(clusters.reduce((n, c) => n + c.outsideCount, 0)).toBe(near.length - inside);
  });

  it('respects filters', async () => {
    const all = await repo.density(q);
    const music = await repo.density({ ...q, categories: ['music'] });
    expect(music.reduce((n, c) => n + c.count, 0)).toBeLessThan(
      all.reduce((n, c) => n + c.count, 0),
    );
  });
});

describe('Supabase density', () => {
  it('calls density_near with the radius, search radius and filters, and maps rows', async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(
          JSON.stringify([
            {
              cell: '881e204',
              center_lat: 51.11,
              center_lng: 17.03,
              event_count: 5,
              outside_count: 2,
              nearest_lat: 51.112,
              nearest_lng: 17.031,
              nearest_m: 640,
              top_venue: 'Rynek',
            },
          ]),
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const r = new SupabaseEventRepository('https://example.supabase.co', 'anon');
    const [c] = await r.density({ ...q, categories: ['music'], price: 'free' });
    expect(fetchMock.mock.calls[0]![0]).toBe(
      'https://example.supabase.co/rest/v1/rpc/density_near',
    );
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body as string)).toMatchObject({
      radius_m: 300,
      search_m: q.searchRadiusM,
      categories: ['music'],
      price: 'free',
    });
    expect(c).toEqual({
      cell: '881e204',
      center: { lat: 51.11, lng: 17.03 },
      count: 5,
      outsideCount: 2,
      nearestOutside: { point: { lat: 51.112, lng: 17.031 }, distanceM: 640 },
      topVenue: 'Rynek',
    });
    vi.unstubAllGlobals();
  });

  it('maps a cell with nothing outside the radius', () => {
    const c = rowToCluster({
      cell: 'x',
      center_lat: 1,
      center_lng: 2,
      event_count: 1,
      outside_count: 0,
      nearest_lat: null,
      nearest_lng: null,
      nearest_m: null,
      top_venue: null,
    });
    expect(c.nearestOutside).toBeNull();
  });
});

describe('guidance', () => {
  const at = (dLat: number) => ({ lat: region.center.lat + dLat, lng: region.center.lng });
  const cluster = (cell: string, count: number, dLat: number): DensityCluster => ({
    cell,
    center: at(dLat),
    count,
    outsideCount: count,
    nearestOutside: { point: at(dLat), distanceM: distanceM(region.center, at(dLat)) },
    topVenue: cell,
  });

  it('points to the nearest event and the busiest spot, and offers a radius that reaches it', () => {
    const clusters = [cluster('far-busy', 9, 0.02), cluster('near', 1, 0.006)];
    const { result } = renderHook(() => useGuidance(clusters, region.center, 500));
    const g = result.current;
    expect(g.nearest?.direction).toBe('n');
    expect(g.nearest?.distanceM).toBeCloseTo(667, -1);
    expect(g.expandTo).toBe(700);
    expect(g.hotspot?.cell).toBe('far-busy');
    expect(g.hotspot?.distanceM).toBeGreaterThan(2000);
  });

  it('has no hotspot below the minimum and nothing to expand when nothing is outside', () => {
    const { result } = renderHook(() => useGuidance([], region.center, 500));
    expect(result.current).toEqual({ hotspot: null, nearest: null, expandTo: null });
  });
});

describe('direction strings', () => {
  it('exist for every compass point in every language', () => {
    for (const d of COMPASS) {
      expect(en[`dir.${d}`]).toBeTruthy();
      expect(pl[`dir.${d}`]).toBeTruthy();
    }
  });
});
