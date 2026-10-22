import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NearbyEvent } from '@happow/core';
import { region } from '../src/config';
import { AreaEventRepository } from '../src/data/area';
import type { SupabaseEventRepository } from '../src/data/supabase';
import { useMinuteClock } from '../src/hooks/useClock';
import { useGeolocation, useStableCenter } from '../src/hooks/useGeolocation';

const row = (id: string, lat: number, lng: number, extra: object = {}) => ({
  id,
  title: id,
  category_ids: ['music'],
  start_at: '2026-10-20T19:00:00Z',
  end_at: '2026-10-20T22:00:00Z',
  end_estimated: false,
  timezone: 'Europe/Warsaw',
  venue_id: null,
  lat,
  lng,
  h3_r9: `h3-${id}`,
  density_cell: 'cell-a',
  is_free: true,
  rules: {},
  status: 'scheduled',
  trust: 'api',
  confidence: 1,
  last_seen_at: '2026-10-20T18:00:00Z',
  ...extra,
});

describe('area repository', () => {
  const center = { lat: 51.11, lng: 17.032 };
  const window = { from: new Date('2026-10-20T20:00:00Z'), to: new Date('2026-10-20T21:00:00Z') };
  let t = Date.parse('2026-10-20T20:01:00Z');
  const db = {
    near: vi.fn(async () => [] as NearbyEvent[]),
    density: vi.fn(async () => []),
    byId: vi.fn(async () => null),
  } as unknown as SupabaseEventRepository;
  const snapshot = {
    from: '2026-10-20T20:00:00Z',
    events: [
      row('close', 51.1101, 17.0321),
      row('far', 51.14, 17.032), // ~3.3 km: outside 500 m, inside the density search
      row('paid', 51.1102, 17.0322, { is_free: false, price_min: 30 }),
    ],
  };

  it('answers the list and the hotspot counts from one download, then filters locally', async () => {
    const fetchArea = vi.fn(async (_url: string) => new Response(JSON.stringify(snapshot)));
    const repo = new AreaEventRepository(db, fetchArea, () => t);
    const q = { center, radiusM: 500, ...window };
    const [list, clusters] = await Promise.all([
      repo.near(q),
      repo.density({ ...q, searchRadiusM: 5000 }),
    ]);
    expect(fetchArea).toHaveBeenCalledTimes(1);
    expect(fetchArea.mock.calls[0]![0]).toBe('/api/area?lat=51.1&lng=17.05&r=5000');
    expect(list.map((e) => e.id)).toEqual(['close', 'paid']);
    expect(clusters).toEqual([
      expect.objectContaining({ cell: 'cell-a', count: 3, outsideCount: 1 }),
    ]);

    // Filters, radius and time windows need no request.
    expect((await repo.near({ ...q, price: 'free' })).map((e) => e.id)).toEqual(['close']);
    expect((await repo.near({ ...q, radiusM: 5000 })).map((e) => e.id)).toContain('far');
    expect(fetchArea).toHaveBeenCalledTimes(1);

    // The next 5-minute step downloads again.
    t = Date.parse('2026-10-20T20:05:01Z');
    await repo.near(q);
    expect(fetchArea).toHaveBeenCalledTimes(2);
  });

  it('downloads the Week snapshot only when chosen, keeps it 30 minutes, and leaves the 24-hour one', async () => {
    t = Date.parse('2026-10-20T20:01:00Z');
    const fetchArea = vi.fn(async (_url: string) => new Response(JSON.stringify(snapshot)));
    const repo = new AreaEventRepository(db, fetchArea, () => t);
    const q = { center, radiusM: 500, ...window };
    await repo.near(q);
    expect(fetchArea).toHaveBeenCalledTimes(1);

    await repo.near({ ...q, range: 'week' });
    expect(fetchArea).toHaveBeenCalledTimes(2);
    expect(fetchArea.mock.calls[1]![0]).toBe('/api/area?lat=51.1&lng=17.05&r=5000&range=week');
    // Switching back and forth costs nothing: each range keeps its own snapshot.
    await repo.near(q);
    await repo.near({ ...q, range: 'week' });
    expect(fetchArea).toHaveBeenCalledTimes(2);

    // After the 5-minute step only the 24-hour snapshot is due; Week lasts 30 minutes.
    t = Date.parse('2026-10-20T20:06:00Z');
    await repo.near({ ...q, range: 'week' });
    expect(fetchArea).toHaveBeenCalledTimes(2);
    t = Date.parse('2026-10-20T20:30:01Z');
    await repo.near({ ...q, range: 'week' });
    expect(fetchArea).toHaveBeenCalledTimes(3);
  });

  it('falls back to direct queries on servers without the area endpoint', async () => {
    const fetchArea = vi.fn(async (_url: string) => new Response('{}', { status: 404 }));
    const repo = new AreaEventRepository(db, fetchArea, () => t);
    await repo.near({ center, radiusM: 500, ...window });
    await repo.near({ center, radiusM: 500, ...window });
    expect(fetchArea).toHaveBeenCalledTimes(1);
    expect(db.near).toHaveBeenCalledTimes(2);
  });
});

describe('location', () => {
  type Ok = (p: GeolocationPosition) => void;
  let calls: { ok: Ok; options: PositionOptions }[];
  const fix = (lat: number, lng: number, accuracy: number) =>
    ({ coords: { latitude: lat, longitude: lng, accuracy } }) as GeolocationPosition;

  beforeEach(() => {
    vi.useFakeTimers();
    calls = [];
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: (ok: Ok, _err: unknown, options: PositionOptions) =>
          calls.push({ ok, options }),
        watchPosition: vi.fn(),
      },
    });
  });
  afterEach(() => vi.useRealTimers());

  it('takes one precise fix, then a cheap one every 5 minutes, never a continuous watch', () => {
    const { result } = renderHook(() => useGeolocation(region));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.options.enableHighAccuracy).toBe(true);
    act(() => calls[0]!.ok(fix(51.11, 17.03, 15)));
    expect(result.current.status).toBe('ok');

    act(() => void vi.advanceTimersByTime(4 * 60_000));
    expect(calls).toHaveLength(1);
    act(() => void vi.advanceTimersByTime(60_000));
    expect(calls).toHaveLength(2);
    expect(calls[1]!.options.enableHighAccuracy).toBe(false);

    // A coarse fix that still contains the precise one is not movement.
    act(() => calls[1]!.ok(fix(51.1105, 17.0305, 800)));
    expect(result.current.position).toEqual({ lat: 51.11, lng: 17.03 });
    expect(navigator.geolocation.watchPosition).not.toHaveBeenCalled();
  });

  it('moves the search centre only after the user has really moved', () => {
    const a = { lat: 51.11, lng: 17.03 };
    const { result, rerender } = renderHook(({ c }) => useStableCenter(c, 100), {
      initialProps: { c: a },
    });
    rerender({ c: { lat: 51.1104, lng: 17.03 } }); // ~45 m
    expect(result.current).toBe(a);
    rerender({ c: { lat: 51.112, lng: 17.03 } }); // ~220 m
    expect(result.current).toEqual({ lat: 51.112, lng: 17.03 });
  });
});

describe('minute clock', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('ticks on the minute and sleeps while the app is hidden', () => {
    vi.setSystemTime(new Date('2026-10-20T20:00:30Z'));
    const { result } = renderHook(() => useMinuteClock());
    act(() => void vi.advanceTimersByTime(31_000));
    expect(result.current.toISOString()).toBe('2026-10-20T20:01:00.050Z');

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    act(() => void vi.advanceTimersByTime(10 * 60_000));
    expect(result.current.toISOString()).toBe('2026-10-20T20:01:00.050Z');

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    // Back on screen: the clock catches up at once (10 minutes after the last tick).
    expect(result.current.toISOString()).toBe('2026-10-20T20:11:01.000Z');
  });
});
