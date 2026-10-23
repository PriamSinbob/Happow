import { useCallback, useEffect, useRef, useState } from 'react';
import { distanceM, isInBbox, type LatLng, type Region } from '@happow/core';
import { config } from '../config';

export type LocationStatus = 'locating' | 'ok' | 'denied' | 'unavailable' | 'outside';

export interface LocationState {
  status: LocationStatus;
  /** The user's real position, when known. */
  position: LatLng | null;
  /** How precise `position` is, in metres (the atlas records only precise fixes). */
  accuracy: number | null;
  /** Where we search from: the user's position inside the region, otherwise the region centre. */
  center: LatLng;
  /** A precise fix now (the locate button). */
  retry: () => void;
}

const INTERVAL_MS = config.app.refresh.locationMinutes * 60_000;

/**
 * Battery first: no continuous GPS watch. One precise fix when the app opens (and on the locate
 * button), then a cheap network-based fix every few minutes while the app is on screen, and when
 * it comes back after a while. Nothing runs in the background. Events are 100 m–25 km away, so a
 * position a few minutes old is plenty.
 */
export function useGeolocation(region: Region): LocationState {
  const [status, setStatus] = useState<LocationStatus>('locating');
  const [fix, setFix] = useState<{ position: LatLng; accuracy: number } | null>(null);
  const last = useRef<{ pos: LatLng; accuracy: number; at: number } | null>(null);

  const ask = useCallback(
    (precise: boolean) => {
      if (!('geolocation' in navigator)) {
        setStatus('unavailable');
        return;
      }
      if (precise) setStatus((s) => (s === 'ok' ? s : 'locating'));
      navigator.geolocation.getCurrentPosition(
        (p) => {
          const here = { lat: p.coords.latitude, lng: p.coords.longitude };
          const accuracy = p.coords.accuracy;
          const prev = last.current;
          // A coarse fix whose uncertainty still contains a better earlier fix is not movement:
          // keep the better one instead of making the dot (and the search) jump.
          if (prev && accuracy > prev.accuracy && distanceM(prev.pos, here) <= accuracy) {
            last.current = { ...prev, at: Date.now() };
            return;
          }
          last.current = { pos: here, accuracy, at: Date.now() };
          setFix({ position: here, accuracy });
          setStatus(isInBbox(here, region.bbox) ? 'ok' : 'outside');
        },
        (err) => {
          if (err.code === err.PERMISSION_DENIED) setStatus('denied');
          // A failed background check keeps the last known position.
          else if (precise || !last.current) setStatus('unavailable');
        },
        precise
          ? { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 }
          : { enableHighAccuracy: false, timeout: 15_000, maximumAge: INTERVAL_MS },
      );
    },
    [region],
  );

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      timer = setTimeout(() => {
        ask(false);
        schedule();
      }, INTERVAL_MS);
    };
    const onVisibility = () => {
      clearTimeout(timer);
      if (document.visibilityState !== 'visible') return;
      if (!last.current || Date.now() - last.current.at >= INTERVAL_MS) ask(false);
      schedule();
    };
    ask(true);
    if (document.visibilityState === 'visible') schedule();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [ask]);

  const retry = useCallback(() => ask(true), [ask]);
  const position = fix?.position ?? null;
  const center = status === 'ok' && position ? position : region.center;
  return { status, position, accuracy: fix?.accuracy ?? null, center, retry };
}

/**
 * The point events are searched around: follows `center` only after it moves `thresholdM`, so
 * small position updates cost no new search or download.
 */
export function useStableCenter(center: LatLng, thresholdM: number): LatLng {
  const [stable, setStable] = useState(center);
  useEffect(() => {
    setStable((s) => (distanceM(s, center) >= thresholdM ? center : s));
  }, [center, thresholdM]);
  return stable;
}
