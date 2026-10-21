import { describe, expect, it } from 'vitest';
import seedJson from '../../../data/seed/wroclaw.events.json';
import {
  circleRing,
  compareByDistanceThenStart,
  dayBounds,
  distanceM,
  getRegion,
  isRunning,
  loadConfig,
  nearby,
  radiusToSlider,
  resolveEnd,
  sliderToRadius,
} from '../src/index.js';
import { materializeSeed } from '../src/seed.js';

const config = loadConfig();

describe('config', () => {
  it('loads and cross-checks every config file', () => {
    expect(config.categories).toHaveLength(14);
    expect(getRegion(config).id).toBe(config.app.defaultRegion);
    expect(getRegion(config, 'nope').id).toBe(config.app.defaultRegion);
  });
});

describe('geo', () => {
  it('measures distances', () => {
    const a = { lat: 51.1099, lng: 17.032 };
    expect(distanceM(a, a)).toBe(0);
    // 0.01° of latitude ≈ 1.11 km
    expect(distanceM(a, { lat: 51.1199, lng: 17.032 })).toBeCloseTo(1112, -1);
  });

  it('draws a closed circle whose vertices sit on the radius', () => {
    const c = { lat: 51.11, lng: 17.03 };
    const ring = circleRing(c, 500, 32);
    expect(ring).toHaveLength(33);
    expect(ring[0]).toEqual(ring[32]);
    for (const [lng, lat] of ring) expect(distanceM(c, { lat, lng })).toBeCloseTo(500, 0);
  });
});

describe('radius slider', () => {
  const { minM, maxM, defaultM } = config.app.radius;
  it('round-trips the default and hits both ends', () => {
    expect(sliderToRadius(radiusToSlider(defaultM, minM, maxM), minM, maxM)).toBe(defaultM);
    expect(sliderToRadius(0, minM, maxM)).toBe(minM);
    expect(sliderToRadius(1, minM, maxM)).toBe(maxM);
  });
  it('snaps to readable values', () => {
    for (let t = 0; t <= 1; t += 0.01) {
      const r = sliderToRadius(t, minM, maxM);
      expect(r % 50).toBe(0);
    }
  });
});

describe('events', () => {
  it('estimates a missing end from the longest category default', () => {
    const start = new Date('2026-10-20T10:00:00Z');
    const d = (c: string) => ({ music: 150, food: 180 })[c];
    expect(resolveEnd(start, null, ['music', 'food'], d)).toEqual({
      endAt: new Date('2026-10-20T13:00:00Z'),
      endEstimated: true,
    });
    const end = new Date('2026-10-20T11:00:00Z');
    expect(resolveEnd(start, end, ['music'], d)).toEqual({ endAt: end, endEstimated: false });
  });

  it('sorts by distance, then start time for events at the same spot', () => {
    const list = [
      { distanceM: 300, startAt: '2026-10-20T10:00:00Z' },
      { distanceM: 100, startAt: '2026-10-20T12:00:00Z' },
      { distanceM: 102, startAt: '2026-10-20T11:00:00Z' },
    ].sort(compareByDistanceThenStart);
    expect(list.map((e) => e.startAt)).toEqual([
      '2026-10-20T11:00:00Z',
      '2026-10-20T12:00:00Z',
      '2026-10-20T10:00:00Z',
    ]);
  });
});

describe('seed', () => {
  const region = getRegion(config);
  const now = new Date('2026-10-20T14:02:00Z');
  const events = materializeSeed(
    seedJson,
    region,
    config.categories,
    now,
    config.app.h3.eventResolution,
  );

  it('has 20 valid events inside the region', () => {
    expect(events).toHaveLength(20);
    for (const e of events) {
      expect(e.point.lat).toBeGreaterThan(region.bbox.south);
      expect(e.point.lat).toBeLessThan(region.bbox.north);
      expect(e.point.lng).toBeGreaterThan(region.bbox.west);
      expect(e.point.lng).toBeLessThan(region.bbox.east);
      expect(new Date(e.endAt) > new Date(e.startAt)).toBe(true);
      expect(e.h3r9).toMatch(/^89/);
    }
  });

  it('always has something running now within the default radius of the centre', () => {
    const close = nearby(events, region.center, config.app.radius.defaultM);
    expect(close.length).toBeGreaterThan(2);
    expect(close.some((e) => isRunning(e, now))).toBe(true);
  });

  it('marks events without a duration as estimated', () => {
    expect(events.filter((e) => e.endEstimated).length).toBeGreaterThan(0);
  });
});

describe('dayBounds', () => {
  it('uses the region timezone, including DST days', () => {
    const { start, end } = dayBounds(new Date('2026-10-20T23:30:00Z'), 'Europe/Warsaw');
    expect(start.toISOString()).toBe('2026-10-20T22:00:00.000Z');
    expect(end.toISOString()).toBe('2026-10-21T21:59:59.999Z');
    const dst = dayBounds(new Date('2026-10-25T12:00:00Z'), 'Europe/Warsaw');
    expect(dst.start.toISOString()).toBe('2026-10-24T22:00:00.000Z');
    expect(dst.end.toISOString()).toBe('2026-10-25T22:59:59.999Z');
  });
});
