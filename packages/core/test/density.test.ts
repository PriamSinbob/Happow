import { describe, expect, it } from 'vitest';
import seedJson from '../../../data/seed/wroclaw.events.json';
import {
  bearing,
  compassPoint,
  densityClusters,
  destination,
  distanceM,
  getRegion,
  hotspot,
  loadConfig,
  nearestOutside,
  snapRadiusUp,
} from '../src';
import { materializeSeed } from '../src/seed';

const config = loadConfig();
const region = getRegion(config);
const now = new Date('2026-10-20T14:00:00Z');
const events = materializeSeed(
  seedJson,
  region,
  config.categories,
  now,
  config.app.h3.eventResolution,
  config.app.h3.densityResolution,
).map((e) => ({ ...e, distanceM: distanceM(region.center, e.point) }));

describe('compass', () => {
  it('computes bearings and 8-point directions', () => {
    const c = region.center;
    expect(compassPoint(bearing(c, destination(c, 1000, 0)))).toBe('n');
    expect(compassPoint(bearing(c, destination(c, 1000, 90)))).toBe('e');
    expect(compassPoint(bearing(c, destination(c, 1000, 225)))).toBe('sw');
    expect(compassPoint(350)).toBe('n');
    expect(compassPoint(-90)).toBe('w');
  });
});

describe('density clusters', () => {
  const clusters = densityClusters(events, 500, (e) => e.densityCell!);

  it('puts every event in exactly one cell, busiest first', () => {
    expect(clusters.reduce((n, c) => n + c.count, 0)).toBe(events.length);
    expect(events.every((e) => e.densityCell)).toBe(true);
    const counts = clusters.map((c) => c.count);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
  });

  it('describes only events beyond the radius as outside', () => {
    const outside = events.filter((e) => e.distanceM > 500).length;
    expect(clusters.reduce((n, c) => n + c.outsideCount, 0)).toBe(outside);
    const nearest = nearestOutside(clusters)!;
    expect(nearest.distanceM).toBe(
      Math.min(...events.filter((e) => e.distanceM > 500).map((e) => e.distanceM)),
    );
  });

  it('names a cell after its most common venue', () => {
    expect(clusters[0]!.topVenue).toBeTruthy();
  });

  it('finds the hotspot only when a cell has enough events', () => {
    const top = hotspot(clusters, region.center, 2, distanceM);
    expect(top?.count).toBe(clusters[0]!.count);
    expect(hotspot(clusters, region.center, 999, distanceM)).toBeNull();
  });

  it('has nothing outside when the radius covers everything', () => {
    expect(nearestOutside(densityClusters(events, 50_000, (e) => e.densityCell!))).toBeNull();
  });
});

describe('snapRadiusUp', () => {
  it('rounds up so the target is inside the new radius', () => {
    expect(snapRadiusUp(612, 100, 25000)).toBe(650);
    expect(snapRadiusUp(1010, 100, 25000)).toBe(1250);
    expect(snapRadiusUp(40, 100, 25000)).toBe(100);
    expect(snapRadiusUp(90000, 100, 25000)).toBe(25000);
  });
});
