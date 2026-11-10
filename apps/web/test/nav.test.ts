import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useLiveLocation } from '../src/hooks/useLiveLocation';
import { headingAlong, pathLength, pointAt, progress } from '../src/nav';

describe('route progress', () => {
  // An L-shaped route: ~111 m north, then ~70 m east.
  const path = [
    { lat: 51.1, lng: 17.0 },
    { lat: 51.101, lng: 17.0 },
    { lat: 51.101, lng: 17.001 },
  ];

  it('measures what is left from the nearest point on the line', () => {
    expect(pathLength(path)).toBeCloseTo(110.5 + 69.9, -1);
    const halfway = progress({ lat: 51.1005, lng: 17.0 }, path);
    expect(halfway.offRouteM).toBeLessThan(1);
    expect(halfway.remainingM).toBeCloseTo(55 + 70, -1);
  });

  it('finds the point a distance along the route', () => {
    expect(pointAt(path, 0)).toEqual(path[0]);
    expect(pointAt(path, 55).lat).toBeCloseTo(51.1005, 4);
    expect(pointAt(path, 9999)).toEqual(path[2]);
  });

  it('faces the way the route runs ahead of the walker', () => {
    // On the first leg: north. Near the corner: turning east. On the second leg: east.
    expect(headingAlong({ lat: 51.1002, lng: 17.0 }, path, 30)).toBeCloseTo(0, 0);
    const corner = headingAlong({ lat: 51.1009, lng: 17.0 }, path, 30)!;
    expect(corner).toBeGreaterThan(20);
    expect(corner).toBeLessThan(90);
    expect(headingAlong({ lat: 51.101, lng: 17.0005 }, path, 30)).toBeCloseTo(90, 0);
    // A walker beside the route faces along it, not towards it.
    expect(headingAlong({ lat: 51.1002, lng: 17.0003 }, path, 30)).toBeCloseTo(0, 0);
    // At the end there is no way ahead.
    expect(headingAlong(path[2]!, path, 30)).toBeNull();
  });

  it('notices when the walker leaves the route', () => {
    const off = progress({ lat: 51.1005, lng: 17.0015 }, path); // ~105 m east of the first leg
    expect(off.offRouteM).toBeGreaterThan(50);
  });
});

describe('live location', () => {
  afterEach(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  });

  it('watches GPS only during a trip and while the app is on screen', () => {
    const watch = vi.fn(() => 7);
    const clear = vi.fn();
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { watchPosition: watch, clearWatch: clear, getCurrentPosition: vi.fn() },
    });
    const { rerender, unmount } = renderHook(({ on }) => useLiveLocation(on), {
      initialProps: { on: false },
    });
    expect(watch).not.toHaveBeenCalled();
    rerender({ on: true });
    expect(watch).toHaveBeenCalledTimes(1);
    expect((watch.mock.calls[0] as unknown[])[2]).toMatchObject({ enableHighAccuracy: true });

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    expect(clear).toHaveBeenCalledWith(7);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    expect(watch).toHaveBeenCalledTimes(2);

    rerender({ on: false }); // arrived / stopped
    expect(clear).toHaveBeenCalledTimes(2);
    unmount();
  });
});
