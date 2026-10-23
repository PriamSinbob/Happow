import { describe, expect, it } from 'vitest';
import {
  clampToEdge,
  dayBins,
  dayIndex,
  dayStarts,
  isOnDay,
  loadConfig,
  nearestDetent,
  radiusToRail,
  railToRadius,
  reachLabel,
  snapTime,
  timeBins,
} from '../src';

const { app } = loadConfig();
const DET = app.radius.detentsM;
const TZ = 'Europe/Warsaw';
const span = (start: string, end: string) => ({ startAt: start, endAt: end });

describe('reach rail', () => {
  it('runs from the first to the last detent on a log scale', () => {
    expect(railToRadius(0, DET)).toBeCloseTo(100);
    expect(railToRadius(1, DET)).toBeCloseTo(5000);
    // Halfway on a log scale from 100 m to 5 km is √(100 × 5000) ≈ 707 m.
    expect(railToRadius(0.5, DET)).toBeCloseTo(707.1, 0);
    expect(radiusToRail(railToRadius(0.3, DET), DET)).toBeCloseTo(0.3);
  });

  it('keeps city mode at the top of the rail', () => {
    expect(radiusToRail(25_000, DET)).toBe(1);
    expect(radiusToRail(50, DET)).toBe(0);
  });

  it('snaps to the nearest detent on the log scale', () => {
    expect(nearestDetent(340, DET)).toBe(250);
    expect(nearestDetent(360, DET)).toBe(500);
    expect(nearestDetent(1400, DET)).toBe(1000);
    expect(nearestDetent(4000, DET)).toBe(5000);
  });

  it('labels the reach in walking minutes up to 2 km, then km', () => {
    expect(reachLabel(100, 80)).toEqual({ kind: 'min', value: 1 });
    expect(reachLabel(500, 80)).toEqual({ kind: 'min', value: 6 });
    expect(reachLabel(2000, 80)).toEqual({ kind: 'min', value: 25 });
    expect(reachLabel(5000, 80)).toEqual({ kind: 'km', value: 5 });
  });
});

describe('time line', () => {
  const now = new Date('2026-10-23T14:12:00Z');
  const end = new Date('2026-10-23T21:59:59.999Z');
  const opts = app.timeline;
  const plus = (min: number) => new Date(now.getTime() + min * 60_000);

  it('snaps to now within 10 minutes, then to 5-minute steps of the clock', () => {
    expect(snapTime(plus(9), now, end, opts)).toEqual(now);
    expect(snapTime(plus(-30), now, end, opts)).toEqual(now);
    expect(snapTime(plus(12), now, end, opts).toISOString()).toBe('2026-10-23T14:25:00.000Z');
    expect(snapTime(plus(600), now, end, opts)).toEqual(end);
  });

  it('counts events running in the middle of each bin', () => {
    const from = new Date('2026-10-23T14:00:00Z');
    const to = new Date('2026-10-23T16:00:00Z');
    const bins = timeBins(
      [
        span('2026-10-23T13:00:00Z', '2026-10-23T18:00:00Z'), // all four
        span('2026-10-23T14:30:00Z', '2026-10-23T15:00:00Z'), // the second
        span('2026-10-23T17:00:00Z', '2026-10-23T18:00:00Z'), // none
      ],
      from,
      to,
      30,
    );
    expect(bins).toEqual([1, 2, 1, 1]);
  });

  it('steps by calendar day across the DST change (25 Oct 2026 has 25 hours)', () => {
    const fri = new Date('2026-10-23T14:00:00Z');
    const starts = dayStarts(fri, TZ, 7);
    expect(starts).toHaveLength(8);
    expect(starts[0]!.toISOString()).toBe('2026-10-22T22:00:00.000Z');
    expect(starts[2]!.toISOString()).toBe('2026-10-24T22:00:00.000Z'); // Sunday 00:00 CEST
    expect(starts[3]!.toISOString()).toBe('2026-10-25T23:00:00.000Z'); // Monday 00:00 CET
    expect((starts[3]!.getTime() - starts[2]!.getTime()) / 3_600_000).toBe(25);
    expect(dayIndex(new Date('2026-10-25T22:30:00Z'), starts)).toBe(2); // 23:30 on Sunday
    expect(dayIndex(new Date('2026-11-01T00:00:00Z'), starts)).toBe(-1);
  });

  it('counts each day an event runs, from now on', () => {
    const fri = new Date('2026-10-23T14:00:00Z');
    const starts = dayStarts(fri, TZ, 3);
    const bins = dayBins(
      [
        span('2026-10-23T08:00:00Z', '2026-10-23T10:00:00Z'), // over before now
        span('2026-10-23T18:00:00Z', '2026-10-23T20:00:00Z'), // tonight
        span('2026-10-23T10:00:00Z', '2026-10-25T20:00:00Z'), // a three-day festival
        span('2026-10-24T20:15:00Z', '2026-10-24T22:15:00Z'), // Sat 22:15–0:15: Saturday only
      ],
      starts,
      fri,
      app.timeline.carryOverMin,
    );
    expect(bins).toEqual([2, 2, 1]);
  });

  it('counts a late show on the day it starts, a festival on every day', () => {
    const sun = new Date('2026-10-24T22:00:00Z');
    const mon = new Date('2026-10-25T23:00:00Z');
    const late = span('2026-10-25T20:15:00Z', '2026-10-25T23:15:00Z');
    const fest = span('2026-10-24T08:00:00Z', '2026-10-27T18:00:00Z');
    expect(isOnDay(late, sun, mon, 360)).toBe(true);
    expect(isOnDay(late, mon, new Date(mon.getTime() + 86_400_000), 360)).toBe(false);
    expect(isOnDay(fest, mon, new Date(mon.getTime() + 86_400_000), 360)).toBe(true);
  });
});

describe('edge dots', () => {
  const rect = { left: 10, top: 60, right: 290, bottom: 500 };
  const from = { x: 150, y: 280 };

  it('leaves points on screen alone', () => {
    expect(clampToEdge({ x: 100, y: 100 }, from, rect)).toBeNull();
  });

  it('puts an off-screen point on the border, along the line from the centre', () => {
    expect(clampToEdge({ x: 150, y: -500 }, from, rect)).toEqual({ x: 150, y: 60 });
    expect(clampToEdge({ x: 1000, y: 280 }, from, rect)).toEqual({ x: 290, y: 280 });
    const corner = clampToEdge({ x: 990, y: 1120 }, from, rect)!;
    expect(corner.x).toBeCloseTo(290);
    expect(corner.y).toBeCloseTo(420);
  });
});
