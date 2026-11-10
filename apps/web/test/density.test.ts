import { renderHook } from '@testing-library/react';
import { COMPASS, distanceM, type DensityCluster } from '@happow/core';
import { describe, expect, it } from 'vitest';
import seed from '../../../data/seed/wroclaw.events.json';
import { config, region } from '../src/config';
import { StaticEventRepository } from '../src/data/static';
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
