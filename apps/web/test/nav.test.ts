import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useLiveLocation } from '../src/hooks/useLiveLocation';
import { pathLength, progress } from '../src/nav';

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
